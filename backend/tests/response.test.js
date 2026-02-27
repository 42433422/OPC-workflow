const { ok, error } = require('../src/utils/response');

function createMockRes() {
  const headers = {};
  return {
    statusCode: null,
    headers,
    body: '',
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(code, hdrs) {
      this.statusCode = code;
      if (hdrs) {
        Object.assign(headers, hdrs);
      }
    },
    end(payload) {
      this.body = payload;
    }
  };
}

describe('response utils', () => {
  test('ok() wraps data correctly', () => {
    const res = createMockRes();
    ok(res, { foo: 'bar' }, '操作成功', 201);

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ foo: 'bar' });
    expect(json.message).toBe('操作成功');
    expect(typeof json.timestamp).toBe('string');
  });

  test('error() wraps error correctly', () => {
    const res = createMockRes();
    error(res, 400, 'BAD_REQUEST', '请求失败', { detail: 'x' });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(false);
    expect(json.error).toEqual({
      code: 'BAD_REQUEST',
      message: '请求失败',
      detail: 'x'
    });
    expect(typeof json.timestamp).toBe('string');
  });
});


