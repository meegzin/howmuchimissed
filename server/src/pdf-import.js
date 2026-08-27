import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { createWorker, OEM, PSM } from 'tesseract.js';
import por from '@tesseract.js-data/por';

globalThis.DOMMatrix ||= DOMMatrix;
globalThis.ImageData ||= ImageData;
globalThis.Path2D ||= Path2D;

const DAYS = [1, 2, 3, 4, 5, 6];

function groupedPositions(values) {
  const groups = [];
  for (const value of values) {
    const last = groups.at(-1);
    if (last && value <= last.at(-1) + 1) last.push(value);
    else groups.push([value]);
  }
  return groups.map(group => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
}

function isDark(data, index) {
  return data[index] < 100 && data[index + 1] < 100 && data[index + 2] < 100;
}

function longestDarkRun(imageData, pageWidth, y, fromX, toX, threshold = 100) {
  let longest = 0; let current = 0;
  for (let x = fromX; x <= toX; x++) {
    const index = (y * pageWidth + x) * 4;
    if (imageData[index] < threshold && imageData[index + 1] < threshold && imageData[index + 2] < threshold) { current++; longest = Math.max(longest, current); }
    else current = 0;
  }
  return longest;
}

function findGrid(imageData, width, height) {
  const longRows = [];
  for (let y = 0; y < height; y++) {
    if (longestDarkRun(imageData, width, y, 0, width - 1, 210) > width * 0.72) longRows.push(y);
  }
  const mainLines = groupedPositions(longRows);
  if (mainLines.length < 3) throw new Error('Não foi possível identificar a tabela de horários.');
  const top = mainLines[0];
  const headerBottom = mainLines[1];
  const bottom = mainLines.at(-1);
  let left = width; let right = 0;
  for (let x = 0; x < width; x++) {
    if (isDark(imageData, (top * width + x) * 4)) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  const timeRight = Math.round(left + (right - left) * 0.1);
  const rowCandidates = [];
  for (let y = headerBottom; y <= bottom; y++) {
    if (longestDarkRun(imageData, width, y, left, timeRight, 210) > (timeRight - left) * 0.65) rowCandidates.push(y);
  }
  const rowLines = groupedPositions(rowCandidates);
  if (rowLines.length < 3) throw new Error('Não foi possível identificar os períodos da grade.');
  const dayWidth = (right - timeRight) / DAYS.length;
  const columns = Array.from({ length: DAYS.length + 1 }, (_, index) => Math.round(timeRight + dayWidth * index));
  return { top, headerBottom, bottom, left, timeRight, rowLines, columns };
}

function crop(source, x, y, width, height, scale = 1) {
  const canvas = createCanvas(width * scale, height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function inkCount(imageData, pageWidth, x1, y1, x2, y2) {
  let count = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
    if (isDark(imageData, (y * pageWidth + x) * 4)) count++;
  }
  return count;
}

function parseCell(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const teacher = lines[0];
  const location = lines.at(-1);
  const name = lines.slice(1, -1).join(' ').replace(/\s+/g, ' ').trim();
  return name ? { name, teacher, location } : null;
}

function normalized(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function minutesBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  return endHour * 60 + endMinute - startHour * 60 - startMinute;
}

export const inferTotalMinutes = weeklyMeetingCount => weeklyMeetingCount * 40 * 60;

export async function inspectTimetablePdf(buffer, { signal } = {}) {
  const abortError = () => new DOMException('Processamento cancelado.', 'AbortError');
  const checkAborted = () => { if (signal?.aborted) throw abortError(); };
  checkAborted();
  if (!buffer?.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('O arquivo enviado não é um PDF válido.');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  if (document.numPages !== 1) throw new Error('Envie uma grade semanal de uma única página.');
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const grid = findGrid(pixels, canvas.width, canvas.height);
  let worker = await createWorker('por', OEM.LSTM_ONLY, { langPath: por.langPath, gzip: por.gzip });
  const abort = () => { worker?.terminate().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
  try {
    checkAborted();
    const titleCanvas = crop(canvas, grid.left, Math.max(0, grid.top - 100), grid.columns.at(-1) - grid.left, 100);
    const rawTitle = (await worker.recognize(titleCanvas.toBuffer('image/png'))).data.text.split('\n').map(v => v.trim()).find(v => v.length > 3) || 'Grade aSc TimeTables';
    const titleText = rawTitle.match(/[A-Z]{2,}\d+.*$/)?.[0] || rawTitle;
    const meetings = [];
    const timeCache = new Map();
    const readPeriod = async row => {
      if (timeCache.has(row)) return timeCache.get(row);
      const y1 = grid.rowLines[row]; const y2 = grid.rowLines[row + 1];
      const timeCanvas = crop(canvas, grid.left + 3, y1 + 3, grid.timeRight - grid.left - 6, y2 - y1 - 6, 3);
      checkAborted();
      const text = (await worker.recognize(timeCanvas.toBuffer('image/png'))).data.text;
      const times = [...text.matchAll(/([01]?\d|2[0-3])[:.]([0-5]\d)/g)].map(match => `${match[1].padStart(2, '0')}:${match[2]}`);
      const result = times.length >= 2 ? { startTime: times[0], endTime: times[1] } : null;
      timeCache.set(row, result); return result;
    };
    for (let column = 0; column < DAYS.length; column++) {
      const activeRows = [];
      for (let row = 0; row < grid.rowLines.length - 1; row++) {
        const count = inkCount(pixels, canvas.width, grid.columns[column] + 8, grid.rowLines[row] + 8, grid.columns[column + 1] - 8, grid.rowLines[row + 1] - 8);
        if (count > 35) activeRows.push(row);
      }
      const groups = [];
      for (const row of activeRows) {
        const last = groups.at(-1);
        const boundaryY = grid.rowLines[row];
        const hasBoundary = longestDarkRun(pixels, canvas.width, boundaryY, grid.columns[column] + 4, grid.columns[column + 1] - 4, 210) > (grid.columns[column + 1] - grid.columns[column]) * 0.65;
        if (last && row === last.at(-1) + 1 && !hasBoundary) last.push(row); else groups.push([row]);
      }
      for (const rows of groups) {
        const first = rows[0]; const last = rows.at(-1);
        const x1 = grid.columns[column] + 3; const y1 = grid.rowLines[first] + 3;
        const cellCanvas = crop(canvas, x1, y1, grid.columns[column + 1] - x1 - 3, grid.rowLines[last + 1] - y1 - 3);
        checkAborted();
        const parsed = parseCell((await worker.recognize(cellCanvas.toBuffer('image/png'))).data.text);
        const start = await readPeriod(first); const end = await readPeriod(last);
        if (parsed && start && end) meetings.push({ ...parsed, weekday: DAYS[column], startTime: start.startTime, endTime: end.endTime });
      }
    }
    if (!meetings.length) throw new Error('Nenhuma aula foi reconhecida neste PDF.');
    const subjects = [];
    for (const meeting of meetings) {
      const key = normalized(meeting.name);
      let subject = subjects.find(item => item.key === key);
      if (!subject) { subject = { key, name: meeting.name, teacher: meeting.teacher, location: meeting.location, schedules: [] }; subjects.push(subject); }
      subject.schedules.push({ weekday: meeting.weekday, startTime: meeting.startTime, endTime: meeting.endTime });
    }
    return {
      sourceName: titleText,
      subjects: subjects.map(({ key: _key, ...subject }) => {
        const durations = subject.schedules.map(item => minutesBetween(item.startTime, item.endTime));
        return { ...subject, meetingMinutes: durations[0], totalMinutes: inferTotalMinutes(subject.schedules.length), selected: true, warnings: durations.some(value => value !== durations[0]) ? ['Os encontros têm durações diferentes; confirme os horários.'] : [] };
      })
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await worker?.terminate().catch(() => {});
    worker = null;
    await document.destroy();
  }
}
