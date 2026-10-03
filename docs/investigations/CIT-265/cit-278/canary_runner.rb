# CIT-278 canary. Uploads one SVG that references THREE distinct dummy files
# and asks Active Storage for a variant. The three references probe how far
# the untrusted image loader will follow a file reference:
#   REL  -> "canary_rel.txt"            (relative; sibling of the temp SVG)
#   ABS  -> file:///tmp/canary_abs.txt  (absolute, same dir as the temp SVG)
#   XDIR -> file:///work/canary_xdir.txt(absolute, a DIFFERENT directory)
# Active Storage identifies the blob as image/svg+xml and, because the app
# thumbnails SVGs (initializer), downloads it to a temp file in Dir.tmpdir
# and renders a variant with the configured processor. Which dummy files are
# actually read is observed externally via strace(openat, O_RDONLY).
require "/app/config/environment"
require "fileutils"

tmp = Dir.tmpdir
FileUtils.mkdir_p("/work")
rel  = File.join(tmp, "canary_rel.txt")
abs  = File.join(tmp, "canary_abs.txt")
xdir = "/work/canary_xdir.txt"
[rel, abs, xdir].each { |f| File.write(f, "CANARY\n") }

svg = <<~SVG
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="96" height="96">
    <image xlink:href="canary_rel.txt" x="0"  width="32" height="32"/>
    <image xlink:href="file://#{abs}"  x="32" width="32" height="32"/>
    <image xlink:href="file://#{xdir}" x="64" width="32" height="32"/>
  </svg>
SVG
path = File.join(tmp, "evil.svg")
File.write(path, svg)

puts "== variant_processor: #{Rails.application.config.active_storage.variant_processor.inspect}"
puts "== VIPS_BLOCK_UNTRUSTED env: #{ENV["VIPS_BLOCK_UNTRUSTED"].inspect}"

blob = ActiveStorage::Blob.create_and_upload!(io: File.open(path), filename: "evil.svg")
puts "== identified content_type=#{blob.content_type} variable?=#{blob.variable?}"

begin
  variant = blob.variant(resize_to_limit: [48, 48]).processed
  variant.download
  puts "== variant processed OK, key=#{variant.key}"
rescue => e
  puts "== variant raised: #{e.class}: #{e.message.lines.first&.strip}"
end
puts "DONE"
