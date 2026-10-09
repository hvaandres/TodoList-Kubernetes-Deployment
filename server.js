const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.env.PORT || 3000);
const buildDirectory = path.join(__dirname, 'build');
const counters = {
  httpRequests: new Map(),
  todoEvents: new Map(),
  frontendErrors: 0,
};

const escapeLabel = value => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n');

const increment = (map, key) => {
  map.set(key, (map.get(key) || 0) + 1);
};

const metrics = () => {
  const lines = [
    '# HELP todo_app_http_requests_total HTTP requests handled by the Todo app.',
    '# TYPE todo_app_http_requests_total counter',
  ];

  counters.httpRequests.forEach((value, key) => {
    const [method, route, status] = key.split('|');
    lines.push(`todo_app_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${value}`);
  });

  lines.push(
    '# HELP todo_app_todo_events_total Todo actions reported by the browser.',
    '# TYPE todo_app_todo_events_total counter',
  );
  counters.todoEvents.forEach((value, event) => {
    lines.push(`todo_app_todo_events_total{event="${escapeLabel(event)}"} ${value}`);
  });

  lines.push(
    '# HELP todo_app_frontend_errors_total Browser errors reported by the frontend.',
    '# TYPE todo_app_frontend_errors_total counter',
    `todo_app_frontend_errors_total ${counters.frontendErrors}`,
  );
  return `${lines.join('\n')}\n`;
};

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

const serveStatic = (request, response) => {
  const requestedPath = decodeURIComponent(request.url.split('?')[0]);
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
  const filePath = path.resolve(buildDirectory, relativePath);
  const isBuildFile = filePath === buildDirectory || filePath.startsWith(`${buildDirectory}${path.sep}`);
  const candidate = isBuildFile && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(buildDirectory, 'index.html');

  fs.readFile(candidate, (error, content) => {
    if (error) {
      response.writeHead(500);
      response.end('Unable to serve the application');
      return;
    }
    const extension = path.extname(candidate);
    const contentTypes = {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
    response.end(content);
  });
};

const server = http.createServer((request, response) => {
  let status = 200;
  const requestedRoute = request.url.split('?')[0];
  const route = ['/healthz', '/metrics', '/telemetry/events'].includes(requestedRoute)
    ? requestedRoute
    : '/';
  const finish = response.end;
  response.end = function end(...args) {
    increment(counters.httpRequests, `${request.method}|${route}|${response.statusCode || status}`);
    return finish.apply(this, args);
  };

  if (request.method === 'GET' && route === '/healthz') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'GET' && route === '/metrics') {
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end(metrics());
    return;
  }
  if (request.method === 'POST' && route === '/telemetry/events') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        const event = JSON.parse(body);
        if (event.type === 'frontend_error') {
          counters.frontendErrors += 1;
        } else if (typeof event.type === 'string' && /^(todo_(created|updated|completed|deleted|cleared|deleted_all))$/.test(event.type)) {
          increment(counters.todoEvents, event.type);
        } else {
          status = 400;
          sendJson(response, status, { error: 'Unsupported telemetry event' });
          return;
        }
        sendJson(response, 202, { accepted: true });
      } catch {
        status = 400;
        sendJson(response, status, { error: 'Invalid telemetry payload' });
      }
    });
    return;
  }
  if (request.method !== 'GET') {
    status = 405;
    response.writeHead(status);
    response.end();
    return;
  }
  serveStatic(request, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Todo app listening on port ${port}`);
});
