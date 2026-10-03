import { ZodError } from "zod";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function guardOrigin(request: Request) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const allowed = new URL(process.env.SITE_URL || request.url).origin;
  if (origin && origin !== allowed)
    throw new AppError("Nguồn yêu cầu không hợp lệ.", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("Yêu cầu không hợp lệ.", 403);
}
export function api(
  handler: (request: Request, context?: unknown) => Promise<unknown>,
) {
  return async (request: Request, context?: unknown) => {
    try {
      guardOrigin(request);
      const data = await handler(request, context);
      return data instanceof Response
        ? data
        : Response.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AppError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      if (error instanceof ZodError)
        return Response.json(
          { error: error.issues[0]?.message || "Dữ liệu chưa hợp lệ." },
          { status: 400 },
        );
      console.error(
        "API error",
        error instanceof Error ? error.message : "Unknown error",
      );
      return Response.json(
        { error: "Không thể xử lý lúc này. Vui lòng thử lại." },
        { status: 500 },
      );
    }
  };
}
