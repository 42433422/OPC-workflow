function ok(res, data = null, message = '操作成功', statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    })
  );
}

function error(res, statusCode = 400, code = 'UNKNOWN_ERROR', message = '请求失败', extra = null) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: false,
      error: {
        code,
        message,
        ...(extra || {})
      },
      timestamp: new Date().toISOString()
    })
  );
}

module.exports = {
  ok,
  error
};


