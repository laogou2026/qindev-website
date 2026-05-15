// 基金数据 API
export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const fundCode = url.searchParams.get('code');
  const limit = parseInt(url.searchParams.get('limit') || '100');

  try {
    let sql, params;
    if (fundCode) {
      sql = 'SELECT fund_code, fund_name, nav_date, nav_value, daily_change_pct FROM fund_data WHERE fund_code = ? ORDER BY nav_date ASC LIMIT ?';
      params = [fundCode, limit];
    } else {
      sql = 'SELECT fund_code, fund_name, nav_date, nav_value, daily_change_pct FROM fund_data ORDER BY fund_code, nav_date ASC LIMIT ?';
      params = [limit];
    }

    const result = await env.DB.prepare(sql).bind(...params).all();
    const rows = result.results || [];

    // 按基金分组
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.fund_code]) {
        grouped[row.fund_code] = {
          code: row.fund_code,
          name: row.fund_name,
          data: []
        };
      }
      grouped[row.fund_code].data.push({
        date: row.nav_date,
        nav: row.nav_value,
        change: row.daily_change_pct
      });
    }

    const etag = await generateETag(JSON.stringify(grouped));
    const ifNoneMatch = context.request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { 'ETag': etag } });
    }

    return new Response(JSON.stringify({ data: Object.values(grouped) }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'ETag': etag,
        'Cache-Control': 'public, max-age=1800'
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function generateETag(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return '"' + hashHex.slice(0, 16) + '"';
}
