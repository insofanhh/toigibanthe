process.env.TEST_BASE_URL ||= "http://127.0.0.1:3000";
await import("./user-account.integration");
export {};
