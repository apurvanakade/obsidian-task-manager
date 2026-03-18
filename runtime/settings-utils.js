const DEFAULT_SETTINGS = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: ""
};

function normalizeTag(tag) {
  const trimmedTag = String(tag || "").trim();
  if (!trimmedTag) {
    return DEFAULT_SETTINGS.nextActionTag;
  }

  return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
}

function normalizeStatusField(field) {
  const trimmedField = String(field || "").trim();
  return trimmedField || DEFAULT_SETTINGS.statusField;
}

function normalizeFolder(folder) {
  return String(folder || "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizeSettings(rawSettings) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    nextActionTag: normalizeTag(rawSettings?.nextActionTag),
    statusField: normalizeStatusField(rawSettings?.statusField),
    projectsFolder: normalizeFolder(rawSettings?.projectsFolder)
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings
};