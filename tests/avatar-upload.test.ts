import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAvatarSource,
  AVATAR_SOURCE_MAX_BYTES,
} from "../src/lib/avatar-upload";

test("Phone photos larger than the host payload are accepted for local resizing", () => {
  assert.doesNotThrow(() =>
    validateAvatarSource({ type: "image/jpeg", size: 10 * 1024 * 1024 }),
  );
});
test("Oversized, empty and unsupported avatar sources are rejected before upload", () => {
  assert.throws(
    () =>
      validateAvatarSource({
        type: "image/jpeg",
        size: AVATAR_SOURCE_MAX_BYTES + 1,
      }),
    /20 MB/,
  );
  assert.throws(
    () => validateAvatarSource({ type: "image/png", size: 0 }),
    /trống/,
  );
  for (const type of ["image/svg+xml", "application/pdf", "image/heic", ""])
    assert.throws(
      () => validateAvatarSource({ type, size: 100 }),
      /JPG, PNG hoặc WebP/,
    );
});
