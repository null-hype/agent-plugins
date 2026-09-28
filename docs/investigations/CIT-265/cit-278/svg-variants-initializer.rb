# CIT-278 canary preconditions (app-level, not an Active Storage patch):
#  - the app thumbnails SVG uploads, so image/svg+xml is a variable type
#  - CIT278_PROCESSOR overrides variant_processor per run (arm A/B vs C)
Rails.application.config.active_storage.variable_content_types |= %w[image/svg+xml]
if (vp = ENV["CIT278_PROCESSOR"]) && !vp.empty?
  Rails.application.config.active_storage.variant_processor = vp.to_sym
end
