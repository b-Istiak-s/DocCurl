export const GENERATED_FILE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "mp4",
  "webm",
  "pdf",
]);

export const GENERATED_UPLOAD_TOKEN_PATTERN = /^([^=]+)=@R&\{([^{}]+)\}$/;
export const GENERATED_UPLOAD_MOUNT_ROOT = "/tmp/doccurl-uploads";
