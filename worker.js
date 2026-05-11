// Cloudflare Worker - 访问统计 + 留言板 API
// 免费方案，无需数据库，使用 KV 存储

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 访问统计 - 每次请求自动+1
    if (path === '/api/count') {
      if (request.method === 'GET') {
        let count = await env.KV.get('view_count', 'text');
        count = count ? parseInt(count) + 1 : 1;
        await env.KV.put('view_count', count.toString());
        return jsonResponse({ count });
      }
    }

    // 留言板 - 获取留言列表
    if (path === '/api/guestbook' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit')) || 20;
      let list = await env.KV.get('guestbook_list', 'json');
      list = list || [];
      return jsonResponse(list.slice(0, limit));
    }

    // 留言板 - 提交留言
    if (path === '/api/guestbook' && request.method === 'POST') {
      try {
        const body = await request.json();
        const name = (body.name || '').trim().slice(0, 20);
        const message = (body.message || '').trim().slice(0, 500);

        if (!name || !message) {
          return jsonResponse({ error: '昵称和留言不能为空' }, 400);
        }

        let list = await env.KV.get('guestbook_list', 'json');
        list = list || [];

        const entry = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name,
          message: message,
          time: new Date().toISOString()
        };

        list.unshift(entry);

        // 只保留最近500条
        if (list.length > 500) list = list.slice(0, 500);

        await env.KV.put('guestbook_list', JSON.stringify(list));
        return jsonResponse(entry);
      } catch (e) {
        return jsonResponse({ error: '提交失败' }, 400);
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}