const sanitizeFileName = (value) => {
  return String(value || 'chart')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
};

export function createChartFileName(title, type = 'chart') {
  const safeTitle = sanitizeFileName(title || 'chart');
  const safeType = sanitizeFileName(type || 'chart');
  return `${safeTitle || 'chart'}-${safeType}.png`;
}

export async function downloadSvgAsPng(svgNode, filename) {
  if (!svgNode) {
    throw new Error('No chart available to export');
  }

  const svgData = new XMLSerializer().serializeToString(svgNode);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const canvas = document.createElement('canvas');
  canvas.width = svgNode.clientWidth || 1200;
  canvas.height = svgNode.clientHeight || 800;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const link = document.createElement('a');
  link.download = filename || 'chart.png';
  link.href = canvas.toDataURL('image/png');
  link.click();

  URL.revokeObjectURL(url);
}

export async function downloadDashboardAsHtml(title, dashboards) {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body><h1>${title}</h1>${(dashboards || []).map((chart) => `<div><h2>${chart.title || 'Chart'}</h2><pre>${JSON.stringify(chart, null, 2)}</pre></div>`).join('')}</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFileName(title || 'dashboard')}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadDashboardAsPng(title, dashboards) {
  if (!dashboards?.length) {
    throw new Error('No dashboard charts to export');
  }

  const container = document.createElement('div');
  container.style.width = '1200px';
  container.style.padding = '24px';
  container.style.background = '#fff';
  container.style.color = '#111';
  container.innerHTML = `<h2>${title}</h2>${(dashboards || []).map((chart) => `<div><h3>${chart.title || 'Chart'}</h3><pre>${JSON.stringify(chart, null, 2)}</pre></div>`).join('')}`;

  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.font = '20px sans-serif';
  ctx.fillText(title, 24, 40);

  const link = document.createElement('a');
  link.download = `${sanitizeFileName(title || 'dashboard')}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  container.remove();
}

export async function downloadDashboardAsPdf(title, dashboards) {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body><h1>${title}</h1>${(dashboards || []).map((chart) => `<div><h2>${chart.title || 'Chart'}</h2><pre>${JSON.stringify(chart, null, 2)}</pre></div>`).join('')}</body></html>`;
  const blob = new Blob([html], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFileName(title || 'dashboard')}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadTransformedDataset({
  format = 'csv',
  authFetch = null,
  rows = null,
  baseName = 'transformed_dataset'
} = {}) {
  const safeBase = sanitizeFileName(baseName) || 'transformed_dataset';
  const fmt = format.toLowerCase().trim();

  // Try downloading pristine full dataset from backend first
  if (authFetch) {
    try {
      const res = await authFetch(`/api/datasets/export?format=${fmt}&filename=${safeBase}`);
      if (res.ok) {
        const blob = await res.blob();
        let filename = `${safeBase}.${fmt === 'excel' ? 'xlsx' : fmt}`;
        const disposition = res.headers.get('content-disposition');
        if (disposition) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match?.[1]) filename = match[1];
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        return { success: true, filename };
      }
    } catch (err) {
      console.warn('Backend export failed, attempting client-side fallback:', err);
    }
  }

  // Client-side fallback if rows are available
  if (rows && rows.length > 0) {
    let blob;
    let filename = `${safeBase}.${fmt}`;

    if (fmt === 'json') {
      const jsonStr = JSON.stringify(rows, null, 2);
      blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    } else {
      // CSV format
      const cols = Object.keys(rows[0]);
      const csvLines = [
        cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','),
        ...rows.map(row => 
          cols.map(col => {
            const val = row[col];
            if (val == null) return '';
            const str = String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(',')
        )
      ];
      blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
      filename = `${safeBase}.csv`;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return { success: true, filename };
  }

  throw new Error('No dataset available to download.');
}

