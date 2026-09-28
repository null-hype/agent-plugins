# CIT-278 canary, cross-directory variant. Single <image> with an ABSOLUTE
# file:// reference to a dummy in a directory OTHER than the temp SVG's dir.
# This isolates each loader's reference policy without the multi-image SVG
# confound: librsvg (vips) refuses cross-directory refs; ImageMagick follows
# absolute file:// refs. Read observed via strace(openat, O_RDONLY).
require "/app/config/environment"
require "fileutils"

FileUtils.mkdir_p("/work")
xdir = "/work/canary_xdir.txt"
File.write(xdir, "CANARY\n")

svg = <<~SVG
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48" height="48">
    <image xlink:href="file://#{xdir}" width="48" height="48"/>
  </svg>
SVG
path = File.join(Dir.tmpdir, "evil.svg")
File.write(path, svg)

puts "== variant_processor: #{Rails.application.config.active_storage.variant_processor.inspect}"
blob = ActiveStorage::Blob.create_and_upload!(io: File.open(path), filename: "evil.svg")
begin
  blob.variant(resize_to_limit: [32, 32]).processed.download
  puts "== variant processed OK"
rescue => e
  puts "== variant raised: #{e.class}: #{e.message.lines.first&.strip}"
end
puts "DONE"
