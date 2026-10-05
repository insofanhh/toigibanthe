/** API failures may come from the host or bundler before our JSON handler runs. */
export async function readApiResponse<T = any>(response: Response): Promise<T> {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Máy chủ trả về dữ liệu không hợp lệ (HTTP ${response.status}). Vui lòng thử lại sau.`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : `Không thể xử lý yêu cầu (HTTP ${response.status}). Vui lòng thử lại.`,
    );
  return data as T;
}
