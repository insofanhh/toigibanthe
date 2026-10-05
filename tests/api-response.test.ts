import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../src/lib/api-response";

test("Host HTTP 413 reports upload size instead of invalid JSON", async () => {
  for (const response of [
    new Response("FUNCTION_PAYLOAD_TOO_LARGE", { status: 413 }),
    Response.json({ error: "File too large" }, { status: 413 }),
  ])
    await assert.rejects(readApiResponse(response), {
      status: 413,
      code: "UPLOAD_TOO_LARGE",
      message:
        "Tệp tải lên quá lớn. Hãy chọn tệp nhỏ hơn hoặc giảm dung lượng ảnh rồi thử lại.",
    });
});

test("HTML server failure becomes a readable error without leaking HTML", async () => {
  await assert.rejects(
    readApiResponse(
      new Response("<!DOCTYPE html><html>internal stack</html>", {
        status: 500,
      }),
    ),
    {
      message:
        "Máy chủ trả về dữ liệu không hợp lệ (HTTP 500). Vui lòng thử lại sau.",
    },
  );
});

test("API validation message is preserved", async () => {
  await assert.rejects(
    readApiResponse(
      Response.json({ error: "Bạn không có quyền." }, { status: 403 }),
    ),
    { message: "Bạn không có quyền." },
  );
});

test("successful JSON is returned intact", async () => {
  assert.deepEqual(
    await readApiResponse(Response.json({ dishes: [], user: null })),
    {
      dishes: [],
      user: null,
    },
  );
});
test("Pending email verification exposes a stable API error code", async () => {
  await assert.rejects(
    readApiResponse(
      Response.json(
        { error: "Xác minh email", code: "EMAIL_VERIFICATION_REQUIRED" },
        { status: 403 },
      ),
    ),
    { status: 403, code: "EMAIL_VERIFICATION_REQUIRED" },
  );
});
