import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../src/lib/api-response";

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
