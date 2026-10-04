import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { rows, exec, pool, sqlDate, transaction } from "../src/lib/db";
import { ensureSePaySchema } from "../src/lib/sepay-schema";
import { sepayBankBin, sepayOrderCode, sepayQR } from "../src/lib/sepay-qr";
import { createOrder, expirePendingOrder, getOrder } from "../src/lib/orders";
import { serviceDate, type Actor } from "../src/lib/domain";
import {
  ensurePaymentRequestSchema,
  backfillPaymentRequests,
  canReadPaymentEvidence,
} from "../src/lib/payment-requests";

const dbURL = new URL(process.env.DATABASE_URL!);
assert.equal(dbURL.hostname, "127.0.0.1");
assert.equal(dbURL.port, "3307");
const base = "http://127.0.0.1:3000";
const ids = {
  chef: randomUUID(),
  otherChef: randomUUID(),
  product: randomUUID(),
  menu: randomUUID(),
  kitchen: randomUUID(),
};
const users: Actor[] = [],
  cookies: string[] = [],
  orders: string[] = [];
const bank = {
  bankBin: "970436",
  bankName: "Vietcombank",
  accountNo: "0001234567890",
  accountName: "LOCAL TEST",
};
let key = "";
async function api(path: string, body?: unknown, who = 0) {
  const r = await fetch(base + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
async function order(
  options: {
    status?: string;
    payment?: string;
    expired?: boolean;
    old?: boolean;
    automatic?: boolean;
  } = {},
) {
  const id = randomUUID(),
    code = randomBytes(options.old ? 6 : 5)
      .toString("hex")
      .toUpperCase();
  orders.push(id);
  await exec(
    "INSERT INTO orders (id,code,user_id,chef_id,meal_id,status,payment_status,subtotal,delivery_fee,total,recipient,phone,address,lat,lng,chef_lat,chef_lng,distance_km,bank_bin,bank_name,account_no,account_name,transfer_content,idempotency_key,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      code,
      users[1].id,
      ids.chef,
      "late",
      options.status || "PLACED",
      options.payment || "PENDING",
      40000,
      10000,
      50000,
      "TEST",
      "0901234567",
      "Địa chỉ kiểm thử",
      10.78,
      106.68,
      10.78,
      106.68,
      0,
      bank.bankBin,
      bank.bankName,
      bank.accountNo,
      bank.accountName,
      `TGBD${options.old ? " " : ""}${code}`,
      randomUUID(),
      sqlDate(new Date(Date.now() + (options.expired ? -10000 : 600000))),
      sqlDate(new Date(Date.now() - 120000)),
      sqlDate(),
    ],
  );
  await exec("INSERT INTO sepay_order_settings VALUES (?,?)", [
    id,
    options.automatic ?? true,
  ]);
  await exec("INSERT INTO order_items VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    id,
    ids.menu,
    ids.product,
    "TEST",
    "https://example.com/fixture.png",
    40000,
    1,
  ]);
  await exec("UPDATE daily_menu SET stock=stock-1 WHERE id=?", [ids.menu]);
  return { id, code };
}
function payload(code: string, fields: Record<string, unknown> = {}) {
  return {
    id:
      String(Date.now()) +
      randomBytes(3).toString("hex").replace(/[a-f]/g, "1"),
    gateway: "Vietcombank",
    transactionDate: sqlDate(new Date(Date.now() + 7 * 3600000)).slice(0, 19),
    accountNumber: bank.accountNo,
    code: null,
    content: `Thanh toan TGBD${code}`,
    description: "Chuyen khoan",
    transferType: "in",
    transferAmount: 50000,
    referenceCode: randomUUID(),
    subAccount: "",
    ...fields,
  };
}
async function webhook(
  p: unknown,
  secret: string | null = key,
  chef: string = ids.chef,
) {
  const r = await fetch(base + "/api/webhooks/sepay/" + chef, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: "Apikey " + secret } : {}),
    },
    body: JSON.stringify(p),
  });
  return { status: r.status, data: await r.json() };
}
async function read(id: string) {
  return (await rows<any>("SELECT * FROM orders WHERE id=?", [id]))[0];
}
try {
  await ensureSePaySchema();
  for (let i = 0; i < 4; i++) {
    const email = `sepay-${randomUUID()}@local.test`,
      r = await api("auth/register", {
        name: "SePay fixture",
        email,
        password: randomUUID(),
      });
    assert.equal(r.status, 200);
    users.push({ ...r.data.user, email });
    cookies.push(r.headers.get("set-cookie")!.split(";")[0]);
  }
  await exec('UPDATE users SET role="chef" WHERE id IN (?,?)', [
    users[0].id,
    users[2].id,
  ]);
  users[0].role = "chef";
  users[2].role = "chef";
  await exec("UPDATE users SET role='admin' WHERE id=?", [users[3].id]);
  users[3].role = "admin";
  for (const [chef, user] of [
    [ids.chef, users[0].id],
    [ids.otherChef, users[2].id],
  ])
    await exec(
      "INSERT INTO chefs (id,user_id,name,bio,address,area,lat,lng,status,bank_bin,bank_name,account_no,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        chef,
        user,
        "SePay fixture",
        "TEST",
        "Địa chỉ kiểm thử",
        "TEST",
        10.78,
        106.68,
        "approved",
        bank.bankBin,
        bank.bankName,
        bank.accountNo,
        bank.accountName,
        sqlDate(),
      ],
    );
  await exec(
    "INSERT INTO products (id,chef_id,name,description,price,image_url,created_at) VALUES (?,?,?,?,?,?,?)",
    [
      ids.product,
      ids.chef,
      "TEST",
      "TEST",
      40000,
      "https://example.com/fixture.png",
      sqlDate(),
    ],
  );
  await exec("INSERT INTO kitchen_sessions VALUES (?,?,?,?,?)", [
    ids.kitchen,
    ids.chef,
    serviceDate(),
    true,
    sqlDate(),
  ]);
  await exec("INSERT INTO daily_menu VALUES (?,?,?,?,?,?,?,?,?)", [
    ids.menu,
    ids.kitchen,
    ids.product,
    "late",
    sqlDate(new Date(Date.now() + 3600000)),
    100,
    null,
    null,
    true,
  ]);
  assert.equal((await api("chef/sepay", undefined, 1)).status, 403);
  key = (await api("chef/sepay/key", {})).data.apiKey;
  assert.ok(key.length >= 32);
  assert.equal(
    (await api("chef/sepay", { enabled: true, apiKey: "short" })).status,
    400,
  );
  assert.equal((await api("chef/sepay", { enabled: true })).status, 400);
  assert.equal(
    (await api("chef/sepay", { enabled: true, apiKey: key })).status,
    200,
  );
  const config = (await api("chef/sepay")).data;
  assert.equal(config.enabled, true);
  assert.equal(config.configured, true);
  assert.ok(config.webhookUrl.endsWith(ids.chef));
  assert.ok(!JSON.stringify(config).includes(key));
  assert.equal(config.key_hash, undefined);
  assert.equal((await api("chef/sepay", { enabled: true })).status, 200);
  assert.equal(
    (
      await rows<any>(
        "SELECT key_hash FROM sepay_integrations WHERE chef_id=?",
        [ids.chef],
      )
    )[0].key_hash,
    createHash("sha256").update(key).digest("hex"),
  );
  const qr = new URL((await api("chef/sepay/qr", {})).data.qr);
  assert.equal(qr.origin, "https://vietqr.app");
  assert.equal(qr.searchParams.get("acc"), bank.accountNo);
  assert.equal(qr.searchParams.get("des"), "TGBDTEST");
  assert.equal((await api("banks")).data.banks.length, 54);
  assert.equal(sepayBankBin("VCB"), bank.bankBin);
  assert.equal(sepayBankBin("MBBank"), "970422");
  assert.equal(
    sepayOrderCode({ content: "TGBD ABCDEF123456" }),
    "ABCDEF123456",
  );
  assert.equal(
    sepayOrderCode({ content: "TGBD1234567890 TGBDABCDEF1234" }),
    null,
  );
  console.log(
    "PASS: cấu hình riêng theo chef, key băm/không lộ, ngân hàng và QR mẫu SePay",
  );

  const activeStatuses = [
    "PLACED",
    "PAID",
    "ACCEPTED",
    "PREPARING",
    "DELIVERING",
    "DELIVERED",
  ];
  const fixtureOrders = [];
  for (const status of [
    ...activeStatuses,
    "COMPLETED",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
  ])
    fixtureOrders.push({ ...(await order({ status })), status });
  const activeList = await api("chef/orders?filter=active");
  assert.equal(activeList.status, 200);
  assert.equal(activeList.data.orders.length, activeStatuses.length);
  assert.deepEqual(
    activeList.data.orders.map((o: any) => o.status).sort(),
    [...activeStatuses].sort(),
  );
  assert.equal(
    (await api("chef/orders")).data.orders.length,
    fixtureOrders.length,
  );
  assert.equal(
    (await api("chef")).data.stats.active_orders,
    activeStatuses.length,
  );
  assert.equal(
    (await api("chef/orders?filter=active", undefined, 2)).data.orders.length,
    0,
  );
  assert.equal(
    (await api("chef/orders?filter=active", undefined, 1)).status,
    403,
  );
  await exec("UPDATE orders SET status='COMPLETED' WHERE id=?", [
    fixtureOrders[1].id,
  ]);
  assert.equal(
    (await api("chef/orders?filter=active")).data.orders.length,
    activeStatuses.length - 1,
  );
  console.log(
    "PASS: bộ lọc chef chỉ lấy đơn đang xử lý của bếp, bao gồm đã giao chưa xác nhận; số thống kê khớp và đơn hoàn thành tự ra khỏi danh sách",
  );

  const requestOrder = await order({
    status: "DELIVERED",
    payment: "PAID_AUTO",
  });
  const refundRequest = {
    kind: "REFUND",
    amount: 50000,
    note: "Khách đề nghị kiểm tra và hoàn tiền.",
    phone: "0901234567",
  };
  assert.equal(
    (
      await api(
        `orders/${requestOrder.id}/exception`,
        { ...refundRequest, phone: "" },
        1,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        `orders/${requestOrder.id}/exception`,
        { ...refundRequest, phone: "not a phone" },
        1,
      )
    ).status,
    400,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception`, refundRequest)).status,
    403,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception`, refundRequest, 2)).status,
    403,
  );
  const simultaneous = await Promise.all([
    api(`orders/${requestOrder.id}/exception`, refundRequest, 1),
    api(`orders/${requestOrder.id}/exception`, refundRequest, 1),
  ]);
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
  const requests = (await api(`orders/${requestOrder.id}`)).data
    .paymentRequests;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "REFUND");
  assert.equal(requests[0].amount, 50000);
  assert.equal(requests[0].note, refundRequest.note);
  assert.equal(requests[0].status, "OPEN");
  assert.equal(requests[0].contact_phone, refundRequest.phone);
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception`, refundRequest, 1)).status,
    409,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}`, undefined, 2)).status,
    403,
  );
  const notices = (await api("notifications")).data.notifications;
  assert.ok(
    notices.some(
      (n: any) =>
        n.title === "Yêu cầu hoàn tiền" &&
        n.href === `/orders/${requestOrder.id}`,
    ),
  );
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    randomUUID(),
    requestOrder.id,
    users[0].id,
    "OVERPAID",
    1000,
    "SePay tự ghi nhận",
    "OPEN",
    sqlDate(),
  ]);
  const proofId = randomUUID(),
    wrongProofId = randomUUID(),
    publicProofId = randomUUID();
  for (const [assetId, owner, kind] of [
    [proofId, users[0].id, "document"],
    [wrongProofId, users[1].id, "document"],
    [publicProofId, users[0].id, "image"],
  ])
    await exec("INSERT INTO assets VALUES (?,?,?,?,?,?,?,?)", [
      assetId,
      owner,
      kind,
      "https://example.com/proof.png",
      "document/proof.png",
      "image/png",
      "proof.png",
      sqlDate(),
    ]);
  const resolution = {
    requestId: requests[0].id,
    note: "Bếp đã trao đổi và hoàn tiền cho khách.",
    evidenceAssetId: proofId,
    resolution: "REFUNDED",
  };
  assert.equal(
    (
      await api(
        `admin/exceptions/${requests[0].id}`,
        { action: "APPROVE", note: "Kiểm tra trước khi có bằng chứng." },
        3,
      )
    ).status,
    409,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception-resolution`, resolution, 1))
      .status,
    403,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception-resolution`, resolution, 2))
      .status,
    403,
  );
  assert.equal(
    (
      await api(`orders/${requestOrder.id}/exception-resolution`, {
        ...resolution,
        evidenceAssetId: wrongProofId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(`orders/${requestOrder.id}/exception-resolution`, {
        ...resolution,
        evidenceAssetId: publicProofId,
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception-resolution`, resolution))
      .status,
    200,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception-resolution`, resolution))
      .status,
    409,
  );
  const reviewRequest = (await api(`orders/${requestOrder.id}`, undefined, 1))
    .data.paymentRequests[0];
  assert.equal(reviewRequest.status, "REVIEW");
  assert.equal(reviewRequest.evidence_asset_id, proofId);
  assert.equal(reviewRequest.resolution_note, resolution.note);
  assert.equal(await canReadPaymentEvidence(users[1].id, proofId), true);
  assert.equal(await canReadPaymentEvidence(users[2].id, proofId), false);
  const unrelatedFile = await fetch(base + "/api/files/" + proofId, {
    headers: { cookie: cookies[2] },
  });
  assert.equal(unrelatedFile.status, 403);
  const adminData = (await api("admin", undefined, 3)).data;
  assert.ok(
    adminData.exceptions.some(
      (e: any) =>
        e.id === requests[0].id &&
        e.evidence_asset_id === proofId &&
        e.contact_phone === refundRequest.phone,
    ),
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${requests[0].id}`,
        { action: "APPROVE", note: "Không có quyền duyệt." },
        1,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${requests[0].id}`,
        { action: "REJECT", note: "Bổ sung ảnh biên lai chuyển khoản đầy đủ." },
        3,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}`)).data.paymentRequests[0].status,
    "OPEN",
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception`, refundRequest, 1)).status,
    409,
  );
  assert.equal(
    (await api(`orders/${requestOrder.id}/exception-resolution`, resolution))
      .status,
    200,
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${requests[0].id}`,
        {
          action: "APPROVE",
          note: "Đã kiểm tra bằng chứng và duyệt giải quyết.",
        },
        3,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${requests[0].id}`,
        { action: "APPROVE", note: "Không duyệt trùng lần nữa." },
        3,
      )
    ).status,
    409,
  );
  for (const who of [0, 1]) {
    const updated = (await api(`orders/${requestOrder.id}`, undefined, who))
      .data.paymentRequests;
    assert.equal(updated.length, 1);
    assert.equal(updated[0].status, "REFUNDED");
    assert.ok(
      (await api("notifications", undefined, who)).data.notifications.some(
        (n: any) => n.title === "Yêu cầu đã xử lý",
      ),
    );
  }
  assert.equal(
    (await read(requestOrder.id)).payment_status,
    "PAID_AUTO",
    "Refunding excess payment must not refund the entire paid order",
  );
  const cancelledRequest = await order({
    status: "CANCELLED",
    payment: "REFUND_PENDING",
  });
  assert.equal(
    (await api(`orders/${cancelledRequest.id}/exception`, refundRequest, 1))
      .status,
    200,
  );
  const cancelledId = (await api(`orders/${cancelledRequest.id}`)).data
    .paymentRequests[0].id;
  assert.equal(
    (
      await api(`orders/${cancelledRequest.id}/exception-resolution`, {
        ...resolution,
        requestId: cancelledId,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${cancelledId}`,
        { action: "APPROVE", note: "Biên lai hoàn tiền hợp lệ." },
        3,
      )
    ).status,
    200,
  );
  assert.equal(
    (await read(cancelledRequest.id)).payment_status,
    "REFUNDED_MANUAL",
  );

  const beforeAcceptance = await order({
    status: "PAID",
    payment: "PAID_AUTO",
  });
  assert.equal(
    (await api(`orders/${beforeAcceptance.id}/exception`, refundRequest, 1))
      .status,
    409,
  );
  await exec("UPDATE users SET phone='0909999999' WHERE id=?", [users[1].id]);
  const cancellation = {
    action: "CANCELLED",
    note: "Khách hủy trước khi bếp nhận đơn.",
  };
  const cancellations = await Promise.all([
    api(`orders/${beforeAcceptance.id}/action`, cancellation, 1),
    api(`orders/${beforeAcceptance.id}/action`, cancellation, 1),
  ]);
  assert.deepEqual(cancellations.map((r) => r.status).sort(), [200, 400]);
  assert.ok(cancellations.some((r) => r.data.refundRequested === true));
  assert.equal((await read(beforeAcceptance.id)).status, "CANCELLED");
  assert.equal(
    (await read(beforeAcceptance.id)).payment_status,
    "REFUND_PENDING",
  );
  const autoRequests = (await api(`orders/${beforeAcceptance.id}`)).data
    .paymentRequests;
  assert.equal(autoRequests.length, 1);
  assert.equal(autoRequests[0].kind, "REFUND");
  assert.equal(autoRequests[0].status, "OPEN");
  assert.equal(autoRequests[0].contact_phone, "0909999999");
  assert.equal(autoRequests[0].amount, 50000);
  assert.ok(autoRequests[0].note.includes(cancellation.note));
  const chefRefundNotices = (
    await api("notifications")
  ).data.notifications.filter(
    (n: any) =>
      n.title === "Yêu cầu hoàn tiền" &&
      n.href === `/orders/${beforeAcceptance.id}`,
  );
  assert.equal(chefRefundNotices.length, 1);
  assert.equal(
    (await api(`orders/${beforeAcceptance.id}/exception`, refundRequest, 1))
      .status,
    409,
  );
  assert.equal(
    (
      await api(`orders/${beforeAcceptance.id}/exception-resolution`, {
        ...resolution,
        requestId: autoRequests[0].id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        `admin/exceptions/${autoRequests[0].id}`,
        { action: "APPROVE", note: "Bằng chứng hoàn tiền cho đơn hủy hợp lệ." },
        3,
      )
    ).status,
    200,
  );
  assert.equal(
    (await read(beforeAcceptance.id)).payment_status,
    "REFUNDED_MANUAL",
  );

  await exec("UPDATE users SET phone='invalid' WHERE id=?", [users[1].id]);
  const partialCancellation = await order();
  assert.equal(
    (await api(`orders/${partialCancellation.id}/exception`, refundRequest, 1))
      .status,
    409,
  );
  assert.equal(
    (
      await webhook(
        payload(partialCancellation.code, { transferAmount: 20000 }),
      )
    ).data.result,
    "PARTIAL",
  );
  assert.equal(
    (await api(`orders/${partialCancellation.id}/action`, cancellation, 1))
      .status,
    200,
  );
  const partialRequest = (await api(`orders/${partialCancellation.id}`)).data
    .paymentRequests[0];
  assert.equal(partialRequest.amount, 20000);
  assert.equal(partialRequest.contact_phone, "0901234567");
  const unpaidCancellation = await order();
  const unpaidResult = await api(
    `orders/${unpaidCancellation.id}/action`,
    cancellation,
    1,
  );
  assert.equal(unpaidResult.status, 200);
  assert.equal(unpaidResult.data.refundRequested, false);
  assert.equal(
    (await api(`orders/${unpaidCancellation.id}`)).data.paymentRequests.length,
    0,
  );
  const chefReject = await order({ status: "PAID", payment: "PAID_AUTO" });
  assert.equal(
    (
      await api(`orders/${chefReject.id}/action`, {
        action: "REJECTED",
        note: "Bếp không thể nhận đơn.",
      })
    ).status,
    200,
  );
  assert.equal(
    (await api(`orders/${chefReject.id}`)).data.paymentRequests[0].kind,
    "REFUND",
  );
  const legacyPaid = await order({ status: "PAID", payment: "PAID_AUTO" }),
    legacyPaidRequestId = randomUUID();
  await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
    legacyPaidRequestId,
    legacyPaid.id,
    users[1].id,
    "WRONG_REFERENCE",
    1000,
    "Yêu cầu đối soát đã có trước bản cập nhật.",
    "REVIEW",
    sqlDate(),
  ]);
  await exec(
    "INSERT INTO payment_request_details (exception_id,order_id,contact_phone,evidence_asset_id,resolution_type) VALUES (?,?,?,?,?)",
    [legacyPaidRequestId, legacyPaid.id, "0901234567", proofId, "RESOLVED"],
  );
  assert.equal(
    (await api(`orders/${legacyPaid.id}/action`, cancellation, 1)).status,
    200,
  );
  const reused = (await api(`orders/${legacyPaid.id}`)).data.paymentRequests;
  assert.equal(reused.length, 1);
  assert.equal(reused[0].id, legacyPaidRequestId);
  assert.equal(reused[0].kind, "REFUND");
  assert.equal(reused[0].status, "OPEN");
  assert.equal(reused[0].amount, 50000);
  assert.equal(reused[0].evidence_asset_id, null);
  assert.equal(
    (
      await api(
        `admin/exceptions/${legacyPaidRequestId}`,
        {
          action: "APPROVE",
          note: "Không duyệt bằng chứng cũ cho khoản hoàn mới.",
        },
        3,
      )
    ).status,
    409,
  );
  await exec("UPDATE users SET phone='' WHERE id=?", [users[1].id]);
  console.log(
    "PASS: đơn chưa nhận không gửi đối soát riêng; hủy đơn đã trả tiền tạo một yêu cầu hoàn tiền cùng giao dịch; thông báo chef, sđt/số tiền đúng; bằng chứng và admin duyệt dùng luồng chung",
  );
  await exec("DELETE FROM assets WHERE id IN (?,?,?)", [
    proofId,
    wrongProofId,
    publicProofId,
  ]);

  // Migrate old duplicate requests without deleting history or allowing a new submission.
  const legacyOrder = await order(),
    firstLegacy = randomUUID(),
    duplicateLegacy = randomUUID();
  for (const [eid, when] of [
    [firstLegacy, "2026-01-01 01:00:00.000"],
    [duplicateLegacy, "2026-01-01 02:00:00.000"],
  ])
    await exec("INSERT INTO payment_exceptions VALUES (?,?,?,?,?,?,?,?)", [
      eid,
      legacyOrder.id,
      users[1].id,
      "REFUND",
      50000,
      "Yêu cầu cũ",
      "OPEN",
      when,
    ]);
  await ensurePaymentRequestSchema();
  await backfillPaymentRequests();
  const legacy = (await api(`orders/${legacyOrder.id}`)).data.paymentRequests;
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].id, firstLegacy);
  assert.equal(legacy[0].contact_phone, "0901234567");
  assert.equal(
    (
      await rows<any>(
        "SELECT COUNT(*) count FROM payment_exceptions WHERE order_id=?",
        [legacyOrder.id],
      )
    )[0].count,
    2,
  );
  assert.equal(
    (await api(`orders/${legacyOrder.id}/exception`, refundRequest, 1)).status,
    409,
  );
  console.log(
    "PASS: một yêu cầu/đơn kể cả đồng thời; sđt bắt buộc; bằng chứng riêng tư và quyền truy cập; chef gửi, admin yêu cầu bổ sung/duyệt; hai bên cập nhật; dữ liệu trùng cũ được giữ",
  );

  const exact = await order(),
    p = payload(exact.code);
  assert.equal((await webhook(p, null, "chef-1")).status, 401);
  assert.equal((await webhook(p, null)).status, 401);
  assert.equal((await webhook(p, "x".repeat(32))).status, 401);
  assert.equal((await webhook(p, key, ids.otherChef)).status, 401);
  assert.equal((await api("chef/sepay", { enabled: false })).status, 200);
  assert.equal((await webhook(p)).status, 403);
  assert.equal((await api("chef/sepay", { enabled: true })).status, 200);
  assert.equal(
    (await webhook({ ...p, transferType: "out" })).data.result,
    "IGNORED",
  );
  assert.equal(
    (await webhook(payload(exact.code, { accountNumber: "0000001111111" })))
      .data.result,
    "ACCOUNT_MISMATCH",
  );
  assert.equal(
    (await webhook(payload(exact.code, { gateway: "BIDV" }))).data.result,
    "ACCOUNT_MISMATCH",
  );
  assert.equal(
    (await webhook(payload(exact.code, { subAccount: "VA123" }))).data.result,
    "ACCOUNT_MISMATCH",
  );
  assert.equal(
    (await webhook(payload(exact.code, { content: "khong co ma don" }))).data
      .result,
    "UNMATCHED",
  );
  assert.equal(
    (
      await webhook(
        payload(exact.code, { transactionDate: "2020-01-01 12:00:00" }),
      )
    ).data.result,
    "INVALID_DATE",
  );
  assert.equal(
    (
      await webhook(
        payload(exact.code, { transactionDate: "2026-02-30 12:00:00" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await api(`orders/${exact.id}/action`, { action: "ACCEPTED" })).status,
    400,
  );
  const raced = await Promise.all([webhook(p), webhook(p)]);
  assert.ok(
    raced.every((r) => r.status === 200),
    JSON.stringify(raced),
  );
  assert.deepEqual(raced.map((r) => r.data.result).sort(), [
    "DUPLICATE",
    "PAID",
  ]);
  assert.equal((await read(exact.id)).status, "PAID");
  assert.equal((await read(exact.id)).payment_status, "PAID_AUTO");
  assert.equal(
    (
      await rows<any>(
        'SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status="PAID"',
        [exact.id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await rows<any>(
        'SELECT COUNT(*) n FROM realtime_outbox WHERE user_id IN (?,?) AND JSON_EXTRACT(payload,"$.title") IN ("Thanh toán thành công","Đơn đã thanh toán")',
        [users[0].id, users[1].id],
      )
    )[0].n,
    2,
  );
  assert.equal(
    (await webhook({ ...p, id: p.id + "1" })).data.result,
    "DUPLICATE",
  );
  assert.equal(
    (await api(`orders/${exact.id}/action`, { action: "ACCEPTED" })).status,
    200,
  );
  assert.equal((await read(exact.id)).payment_status, "PAID_AUTO");
  console.log(
    "PASS: auth, khớp tài khoản/mã/thời gian; webhook đồng thời chỉ thanh toán một lần; chef nhận đơn đã trả tiền",
  );

  const unreferenced = await order();
  await exec("UPDATE orders SET total=62000 WHERE id=?", [unreferenced.id]);
  const unrelated = payload(unreferenced.code, {
    code: null,
    content: "HA VAN ANH chuyen tien",
    description: "BankAPINotify HA VAN ANH chuyen tien",
    transferAmount: 70000,
    accountNumber: "000000007101",
  });
  const unmatched = await webhook(unrelated);
  assert.equal(unmatched.data.result, "UNMATCHED");
  assert.equal(unmatched.data.reason, "ACCOUNT_NOT_CONFIGURED");
  assert.equal((await read(unreferenced.id)).payment_status, "PENDING");
  // Editing a failed receipt must never turn a different amount/account into a payment.
  assert.equal(
    (
      await webhook({
        ...unrelated,
        accountNumber: bank.accountNo,
        transferAmount: 62000,
        code: unreferenced.code,
      })
    ).data.result,
    "DUPLICATE",
  );
  assert.equal((await read(unreferenced.id)).status, "PLACED");
  const diagnostic = (await api("chef/sepay")).data.transactions.find(
    (t: any) => t.transaction_id === unrelated.id,
  );
  assert.equal(diagnostic.description, unrelated.description);
  assert.equal(diagnostic.receiver_last4, "7101");
  assert.equal(diagnostic.failure_reason, "ACCOUNT_NOT_CONFIGURED");
  assert.equal(diagnostic.account_number, undefined);

  const enriched = await order(),
    initial = payload(enriched.code, {
      content: "Chuyen khoan",
      code: null,
      description: null,
    });
  assert.equal((await webhook(initial)).data.result, "UNMATCHED");
  const retried = await Promise.all([
    webhook({ ...initial, code: enriched.code }),
    webhook({ ...initial, code: enriched.code }),
  ]);
  assert.deepEqual(retried.map((r) => r.data.result).sort(), [
    "DUPLICATE",
    "PAID",
  ]);
  assert.equal(
    (
      await rows<any>(
        'SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status="PAID"',
        [enriched.id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    sepayOrderCode({ code: enriched.code, content: "Chuyen khoan" }),
    enriched.code,
  );
  assert.equal(
    sepayOrderCode({
      code: enriched.code,
      content: `TGBD${unreferenced.code}`,
    }),
    null,
  );
  console.log(
    "PASS: thiếu mã/sai tài khoản không ghi nhận nhầm; lưu chẩn đoán; retry bổ sung mã chỉ nhận đúng một lần, không sửa số tiền/tài khoản",
  );

  const partial = await order();
  assert.equal(
    (await webhook(payload(partial.code, { transferAmount: 20000 }))).data
      .result,
    "PARTIAL",
  );
  assert.equal((await read(partial.id)).status, "PLACED");
  const remainingQR = new URL(
    (await api(`orders/${partial.id}/qr`, undefined, 1)).data.qr,
  );
  assert.equal(remainingQR.searchParams.get("amount"), "30000");
  assert.equal(
    (await webhook(payload(partial.code, { transferAmount: 30000 }))).data
      .result,
    "PAID",
  );
  const over = await order();
  assert.equal(
    (await webhook(payload(over.code, { transferAmount: 60000 }))).data.result,
    "OVERPAID",
  );
  assert.equal((await read(over.id)).payment_status, "PAYMENT_REVIEW");
  assert.equal((await read(over.id)).status, "PLACED");
  const completed = await order({ status: "COMPLETED", payment: "PAID_AUTO" });
  assert.equal(
    (await webhook(payload(completed.code))).data.result,
    "EXTRA_PAYMENT",
  );
  assert.equal((await read(completed.id)).payment_status, "PAID_AUTO");
  assert.equal((await read(completed.id)).status, "COMPLETED");
  const extra = (
    await rows<any>("SELECT id FROM payment_exceptions WHERE order_id=?", [
      completed.id,
    ])
  )[0];
  await exec('UPDATE users SET role="admin" WHERE id=?', [users[2].id]);
  assert.equal(
    (
      await api(
        `admin/exceptions/${extra.id}`,
        { status: "REFUNDED", note: "Hoàn riêng khoản tiền chuyển thừa" },
        2,
      )
    ).status,
    200,
  );
  assert.equal((await read(completed.id)).payment_status, "PAID_AUTO");
  await exec('UPDATE users SET role="chef" WHERE id=?', [users[2].id]);
  const cancelled = await order({ status: "CANCELLED" });
  assert.equal((await webhook(payload(cancelled.code))).data.result, "LATE");
  assert.equal((await read(cancelled.id)).status, "CANCELLED");
  assert.equal((await read(cancelled.id)).payment_status, "REFUND_PENDING");
  const expired = await order({ expired: true });
  const before = (
    await rows<any>("SELECT stock FROM daily_menu WHERE id=?", [ids.menu])
  )[0].stock;
  const late = payload(expired.code);
  assert.equal((await webhook(late)).data.result, "LATE");
  assert.equal((await read(expired.id)).status, "EXPIRED");
  assert.equal(
    (await rows<any>("SELECT stock FROM daily_menu WHERE id=?", [ids.menu]))[0]
      .stock,
    before + 1,
  );
  assert.equal((await webhook(late)).data.result, "DUPLICATE");
  assert.equal(
    (await rows<any>("SELECT stock FROM daily_menu WHERE id=?", [ids.menu]))[0]
      .stock,
    before + 1,
  );
  const partialExpiry = await order();
  await webhook(payload(partialExpiry.code, { transferAmount: 10000 }));
  await exec("UPDATE orders SET expires_at=? WHERE id=?", [
    sqlDate(new Date(Date.now() - 1000)),
    partialExpiry.id,
  ]);
  await transaction(async (db) => {
    const o = await getOrder(partialExpiry.id, users[0], db, true);
    await expirePendingOrder(db, o);
  });
  assert.equal((await read(partialExpiry.id)).payment_status, "REFUND_PENDING");
  const old = await order({ old: true, automatic: false });
  assert.equal(
    (
      await webhook(
        payload(old.code, { content: `Thanh toan TGBD ${old.code}` }),
      )
    ).data.result,
    "PAID",
  );
  const reject = await order();
  await webhook(payload(reject.code));
  assert.equal(
    (
      await api(`orders/${reject.id}/action`, {
        action: "REJECTED",
        note: "Không thể giao",
      })
    ).status,
    200,
  );
  assert.equal((await read(reject.id)).payment_status, "REFUND_PENDING");
  console.log(
    "PASS: thiếu tiền cộng dồn, dư tiền đối soát, tiền vào sau hạn/hủy không mở lại, trả tồn kho một lần, hủy đơn đã thanh toán và mã cũ",
  );

  // Old orders retain their bank snapshot even when the chef changes bank.
  await api("chef/bank", { ...bank, accountNo: "0009999999999" });
  const snapshot = await order();
  const snapshotQR = new URL(
    (await api(`orders/${snapshot.id}/qr`, undefined, 1)).data.qr,
  );
  assert.equal(snapshotQR.searchParams.get("acc"), bank.accountNo);
  assert.equal((await webhook(payload(snapshot.code))).data.result, "PAID");
  const original = process.env.GOONG_API_KEY;
  delete process.env.GOONG_API_KEY;
  try {
    const created = await createOrder(users[1], {
      items: [{ menuId: ids.menu, quantity: 1 }],
      address: "Địa chỉ kiểm thử",
      lat: 10.78,
      lng: 106.68,
      recipient: "TEST",
      phone: "0901234567",
      idempotencyKey: randomUUID(),
    });
    orders.push(created.id);
    const record = await getOrder(created.id, users[1]);
    assert.equal(record.automatic_payment, 1);
    assert.equal(record.account_no, "0009999999999");
    assert.equal(record.code.length, 10);
    assert.equal(record.transfer_content, `TGBD${record.code}`);
    assert.equal(
      new URL(
        sepayQR({
          bankBin: record.bank_bin,
          accountNo: record.account_no,
          accountName: record.account_name,
          amount: record.total,
          content: record.transfer_content,
        }),
      ).searchParams.get("acc"),
      record.account_no,
    );
  } finally {
    if (original !== undefined) process.env.GOONG_API_KEY = original;
  }
  const rotated = (await api("chef/sepay/key", {})).data.apiKey;
  await api("chef/sepay", { enabled: true, apiKey: rotated });
  assert.equal((await webhook(payload(exact.code))).status, 401);
  console.log(
    "PASS: snapshot ngân hàng/automatic cho đơn mới, mã 10 ký tự, đổi key vô hiệu key cũ",
  );
} finally {
  // Also remove fixture notifications delivered to pre-existing local administrators.
  for (const id of orders) {
    const o = await read(id);
    if (!o) continue;
    const pattern = `%${o.code}%`;
    await exec(
      "DELETE r FROM outbox_receipts r JOIN realtime_outbox o ON o.id=r.event_id WHERE CAST(o.payload AS CHAR) LIKE ?",
      [pattern],
    );
    await exec(
      "DELETE FROM realtime_outbox WHERE CAST(payload AS CHAR) LIKE ?",
      [pattern],
    );
    await exec("DELETE FROM notifications WHERE body LIKE ?", [pattern]);
  }
  await exec(
    "DELETE FROM assets WHERE user_id IN (?,?,?,?)",
    users.map((u) => u.id),
  );
  await exec("DELETE FROM sepay_transaction_details WHERE chef_id IN (?,?)", [
    ids.chef,
    ids.otherChef,
  ]);
  for (const id of orders)
    for (const table of [
      "sepay_order_settings",
      "order_items",
      "order_events",
      "payment_exceptions",
      "payment_request_details",
      "reviews",
    ])
      await exec(`DELETE FROM ${table} WHERE order_id=?`, [id]);
  await exec("DELETE FROM sepay_transactions WHERE chef_id IN (?,?)", [
    ids.chef,
    ids.otherChef,
  ]);
  await exec("DELETE FROM sepay_integrations WHERE chef_id IN (?,?)", [
    ids.chef,
    ids.otherChef,
  ]);
  for (const id of orders) await exec("DELETE FROM orders WHERE id=?", [id]);
  await exec("DELETE FROM daily_menu WHERE id=?", [ids.menu]);
  await exec("DELETE FROM kitchen_sessions WHERE id=?", [ids.kitchen]);
  await exec("DELETE FROM products WHERE id=?", [ids.product]);
  await exec("DELETE FROM chefs WHERE id IN (?,?)", [ids.chef, ids.otherChef]);
  for (const u of users) {
    await exec("DELETE FROM audit_logs WHERE actor_id=?", [u.id]);
    await exec("DELETE FROM sessions WHERE user_id=?", [u.id]);
    await exec("DELETE FROM notifications WHERE user_id=?", [u.id]);
    await exec(
      "DELETE r FROM outbox_receipts r JOIN realtime_outbox o ON o.id=r.event_id WHERE o.user_id=?",
      [u.id],
    );
    await exec("DELETE FROM realtime_outbox WHERE user_id=?", [u.id]);
    await exec("DELETE FROM users WHERE id=?", [u.id]);
    await exec("DELETE FROM platform_settings WHERE id=?", [
      "login:" +
        createHash("sha256").update(u.email).digest("hex").slice(0, 40),
    ]);
  }
  await pool().end();
}
