// Cloudflare Pages Functions - qindev-site
// D1 数据库 + KV 限流 + ETag 缓存

// ── Rate Limit 配置 ──
const RATE_LIMIT_WINDOW = 60; // 秒
const RATE_LIMIT_MAX = 10;    // 每窗口最大请求数

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // ── 访问统计 API（D1 原子操作）──
  if (path === '/api/count' && request.method === 'GET') {
    try {
      await env.DB.prepare('UPDATE visit_count SET count = count + 1 WHERE id = 1').run();
      const result = await env.DB.prepare('SELECT count FROM visit_count WHERE id = 1').first();
      return jsonResponse({ count: result?.count || 0 });
    } catch (e) {
      return jsonResponse({ count: 0, error: e.message }, 500);
    }
  }

  // ── 留言板 API（D1 + KV Rate Limit）──
  if (path === '/api/guestbook') {
    if (request.method === 'GET') {
      try {
        const result = await env.DB.prepare(
          'SELECT id, name, message, created_at FROM guestbook ORDER BY created_at DESC LIMIT 50'
        ).all();
        return jsonResponse({ data: result.results || [] });
      } catch (e) {
        return jsonResponse({ data: [], error: e.message }, 500);
      }
    }

    if (request.method === 'POST') {
      // KV Rate Limit 检查
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitKey = `ratelimit:guestbook:${clientIP}`;
      const limited = await checkRateLimit(env, rateLimitKey);
      if (limited) {
        return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
      }

      try {
        const body = await request.json();
        const name = (body.name || '').trim();
        const message = (body.message || '').trim();

        if (!name || !message) {
          return jsonResponse({ error: '昵称和留言不能为空' }, 400);
        }
        if (name.length > 20) {
          return jsonResponse({ error: '昵称最多20个字' }, 400);
        }
        if (message.length > 500) {
          return jsonResponse({ error: '留言最多500个字' }, 400);
        }

        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const created_at = new Date().toISOString();

        await env.DB.prepare(
          'INSERT INTO guestbook (id, name, message, created_at) VALUES (?, ?, ?, ?)'
        ).bind(id, name, message, created_at).run();

        return jsonResponse({ data: { id, name, message, created_at } });
      } catch (e) {
        return jsonResponse({ error: '提交失败: ' + e.message }, 400);
      }
    }
  }

  // ── 项目数据 API（D1 + ETag 缓存）──
  if (path === '/api/projects' && request.method === 'GET') {
    try {
      const result = await env.DB.prepare(
        'SELECT id, icon, name, description, stack, sort_order FROM projects ORDER BY sort_order ASC'
      ).all();
      const list = (result.results || []).map(p => ({
        id: p.id,
        icon: p.icon,
        name: p.name,
        desc: p.description,
        stack: JSON.parse(p.stack)
      }));

      const etag = await generateETag(JSON.stringify(list));
      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { 'ETag': etag } });
      }

      return new Response(JSON.stringify({ data: list }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'ETag': etag,
          'Cache-Control': 'public, max-age=3600'
        }
      });
    } catch (e) {
      return jsonResponse({ data: [], error: e.message }, 500);
    }
  }

  return new Response('Not Found', { status: 404 });
}

// ── KV Rate Limit 实现 ──
async function checkRateLimit(env, key) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    // 获取当前计数
    const raw = await env.DATA.get(key);
    let data = raw ? JSON.parse(raw) : { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    
    // 窗口过期，重置
    if (now >= data.resetAt) {
      data = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    }
    
    data.count += 1;
    await env.DATA.put(key, JSON.stringify(data), { expirationTtl: RATE_LIMIT_WINDOW });
    
    return data.count > RATE_LIMIT_MAX;
  } catch (e) {
    // KV 异常时不限流
    return false;
  }
}

// ── 工具函数 ──
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function generateETag(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return '"' + hashHex.slice(0, 16) + '"';
}
