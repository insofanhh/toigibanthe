export class ApiResponseError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
/** API failures may come from the host or bundler before our JSON handler runs. */
export async function readApiResponse<T = any>(response: Response): Promise<T> {
  if (response.status === 413)
    throw new ApiResponseError(
      "Tệp tải lên quá lớn. Hãy chọn tệp nhỏ hơn hoặc giảm dung lượng ảnh rồi thử lại.",
      413,
      "UPLOAD_TOO_LARGE",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Máy chủ trả về dữ liệu không hợp lệ (HTTP ${response.status}). Vui lòng thử lại sau.`,
    );
  }
  if (!response.ok)
    throw new ApiResponseError(
      typeof data?.error === "string"
        ? data.error
        : `Không thể xử lý yêu cầu (HTTP ${response.status}). Vui lòng thử lại.`,
      response.status,
      typeof data?.code === "string" ? data.code : undefined,
    );
  return data as T;
}
