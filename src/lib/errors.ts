// Lỗi do dữ liệu/thao tác của người dùng (trả mã 4xx kèm thông báo tiếng Việt), khác với lỗi hệ thống.

export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
