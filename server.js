const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const sharp = require("sharp");
const nodemailer = require("nodemailer");
const opentype = require("opentype.js");
const ExcelJS = require("exceljs");
const { neon } = require("@neondatabase/serverless");
const { createClient } = require("@supabase/supabase-js");
const mysql = require("mysql2/promise");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STATIC_DIR = path.join(__dirname, "frontend", "dist");
const APP_URL = normalizeAppUrl(process.env.APP_URL) || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);
const DATABASE_URL = normalizeDatabaseUrl(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const MP_PUBLIC_KEY = String(process.env.MERCADO_PAGO_PUBLIC_KEY || "").trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").replace(/\s/g, "");
const MYSQL_HOST = String(process.env.MYSQL_HOST || "").trim();
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_DATABASE = String(process.env.MYSQL_DATABASE || "").trim();
const MYSQL_USER = String(process.env.MYSQL_USER || "").trim();
const MYSQL_PASSWORD = String(process.env.MYSQL_PASSWORD || "");
const configuredMercadoPagoTimeout = Number(process.env.MERCADO_PAGO_TIMEOUT_MS || 12000);
const MERCADO_PAGO_TIMEOUT_MS = Number.isFinite(configuredMercadoPagoTimeout)
  ? Math.min(Math.max(configuredMercadoPagoTimeout, 5000), 30000)
  : 12000;

const neonSql = DATABASE_URL ? neon(DATABASE_URL) : null;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const mysqlPool = MYSQL_HOST && MYSQL_DATABASE && MYSQL_USER && MYSQL_PASSWORD
  ? mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      database: MYSQL_DATABASE,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true
    })
  : null;
const tables = ["users", "tickets", "settings", "sessions"];
const tableNames = new Set(tables);
const dejavuFontsDir = path.join(__dirname, "assets", "fonts");
const compiledBrandingDir = path.join(STATIC_DIR, "branding");
const sourceBrandingDir = path.join(__dirname, "frontend", "public", "branding");
const brandingDir = fs.existsSync(compiledBrandingDir) ? compiledBrandingDir : sourceBrandingDir;
const ticketFontRegular = opentype.loadSync(path.join(dejavuFontsDir, "DejaVuSans.ttf"));
const ticketFontBold = opentype.loadSync(path.join(dejavuFontsDir, "DejaVuSans-Bold.ttf"));
const DEFAULT_ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL);
const DEFAULT_ADMIN_BIRTH_DATE = String(process.env.ADMIN_BIRTH_DATE || "").replace(/\D/g, "");
let seedDone = false;
let schemaReady = false;
let mysqlReadyPromise = null;

function normalizeAppUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function normalizeSupabaseUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "").replace(/\/rest\/v1\/?$/, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function normalizeDatabaseUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "");
  try {
    const url = new URL(trimmed);
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return trimmed;
  }
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function numberOrDefault(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return Number(fallback || 0);
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback || 0);
}

function createTicketCode(usedCodes = new Set()) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@*+%$";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += chars[crypto.randomInt(chars.length)];
    }
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  throw new Error("Não foi possível gerar um código único para o ingresso.");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const mercadoPagoWaitingStatuses = new Set(["pending", "in_process", "authorized"]);
const mercadoPagoFinalUnpaidStatuses = new Set(["rejected", "cancelled", "refunded", "charged_back", "in_mediation"]);
const mercadoPagoKnownStatuses = new Set(["approved", ...mercadoPagoWaitingStatuses, ...mercadoPagoFinalUnpaidStatuses]);
const mercadoPagoPaymentLocks = new Map();
const mercadoPagoCheckoutRequests = new Set();
const ticketTypeDiscounts = {
  inteiro: 0,
  meia: 0.5
};
const ticketTypes = new Set(["inteiro", "meia", "social"]);
const saleLots = new Set(["relampago", "lote2", "lote3", "lote4"]);

function isMercadoPagoWaiting(ticket) {
  const status = ticket.mercadoPagoStatus;
  return !status || mercadoPagoWaitingStatuses.has(status);
}

function isTicketPaid(ticket) {
  if (ticket.mercadoPagoStatus === "manual") return ticket.status === "confirmed";
  if (ticket.mercadoPagoStatus) return ticket.mercadoPagoStatus === "approved";
  return ticket.status === "confirmed";
}

function isExpiredPendingTicket(ticket) {
  if (ticket.status !== "pending" || !isMercadoPagoWaiting(ticket)) return false;
  const expiration = ticket.paymentExpiresAt
    ? new Date(ticket.paymentExpiresAt).getTime()
    : ticket.createdAt
      ? new Date(ticket.createdAt).getTime() + 1000 * 60 * 60
      : Number.NaN;
  return Number.isFinite(expiration) && Date.now() > expiration;
}

function webhookLog(message, details = {}) {
  console.log("[Mercado Pago webhook]", message, details);
}

function mercadoPagoLog(message, details = {}) {
  console.log("[Mercado Pago]", message, details);
}

function withMercadoPagoPaymentLock(paymentId, operation) {
  const key = String(paymentId);
  const previous = mercadoPagoPaymentLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mercadoPagoPaymentLocks.set(key, current);
  return current.finally(() => {
    if (mercadoPagoPaymentLocks.get(key) === current) mercadoPagoPaymentLocks.delete(key);
  });
}

function ensureLocalFiles() {
  if (mysqlPool || neonSql || supabase) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const table of tables) {
    const file = path.join(DATA_DIR, `${table}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  }
}

function readLocal(table) {
  ensureLocalFiles();
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${table}.json`), "utf8"));
}

function writeLocal(table, rows) {
  ensureLocalFiles();
  fs.writeFileSync(path.join(DATA_DIR, `${table}.json`), JSON.stringify(rows, null, 2));
}

function assertTable(table) {
  if (!tableNames.has(table)) throw new Error("Tabela inválida.");
}

async function neonAll(table) {
  if (table === "users") return neonSql`select id, data from users`;
  if (table === "tickets") return neonSql`select id, data from tickets`;
  if (table === "settings") return neonSql`select id, data from settings`;
  return neonSql`select id, data from sessions`;
}

async function neonSave(table, record) {
  const payload = JSON.stringify(record);
  if (table === "users") {
    return neonSql`insert into users (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  if (table === "tickets") {
    return neonSql`insert into tickets (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  if (table === "settings") {
    return neonSql`insert into settings (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  return neonSql`insert into sessions (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
}

async function neonDelete(table, idValue) {
  if (table === "users") return neonSql`delete from users where id = ${idValue}`;
  if (table === "tickets") return neonSql`delete from tickets where id = ${idValue}`;
  if (table === "settings") return neonSql`delete from settings where id = ${idValue}`;
  return neonSql`delete from sessions where id = ${idValue}`;
}

async function ensureNeonSchema() {
  if (!neonSql || schemaReady) return;
  await neonSql`
    create table if not exists users (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists tickets (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists settings (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists sessions (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  schemaReady = true;
}

function parseMysqlData(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function ensureMysqlReady() {
  if (!mysqlPool) return;
  if (!mysqlReadyPromise) {
    mysqlReadyPromise = (async () => {
      for (const table of tables) {
        await mysqlPool.execute(`
          create table if not exists \`${table}\` (
            id varchar(255) primary key,
            data json not null,
            updated_at timestamp default current_timestamp on update current_timestamp
          ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
        `);
      }
      await mysqlPool.execute(`
        create table if not exists migration_meta (
          id varchar(255) primary key,
          details json not null,
          completed_at timestamp default current_timestamp
        ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
      `);

      if (!neonSql || process.env.MIGRATE_NEON_TO_MYSQL !== "1") return;
      const [existing] = await mysqlPool.execute(
        "select id from migration_meta where id = ? limit 1",
        ["neon-v1"]
      );
      if (existing.length) return;

      await ensureNeonSchema();
      const connection = await mysqlPool.getConnection();
      const counts = {};
      try {
        await connection.beginTransaction();
        for (const table of ["users", "tickets", "settings"]) {
          const rows = await neonAll(table);
          counts[table] = rows.length;
          for (const row of rows) {
            await connection.execute(
              `insert into \`${table}\` (id, data, updated_at) values (?, ?, current_timestamp)
               on duplicate key update data = values(data), updated_at = current_timestamp`,
              [row.id, JSON.stringify(row.data || {})]
            );
          }
          const [targetCountRows] = await connection.execute(`select count(*) as total from \`${table}\``);
          const targetCount = Number(targetCountRows[0]?.total || 0);
          if (targetCount < rows.length) {
            throw new Error(`Migração incompleta em ${table}: origem=${rows.length}, destino=${targetCount}`);
          }
        }
        await connection.execute(
          "insert into migration_meta (id, details) values (?, ?)",
          ["neon-v1", JSON.stringify({ source: "neon", counts, completedAt: now() })]
        );
        await connection.commit();
        console.log("Migração Neon -> MySQL concluída:", counts);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    })().catch((error) => {
      mysqlReadyPromise = null;
      throw error;
    });
  }
  return mysqlReadyPromise;
}

async function mysqlAll(table) {
  await ensureMysqlReady();
  const [rows] = await mysqlPool.execute(`select id, data from \`${table}\``);
  return rows.map((row) => ({ id: row.id, ...parseMysqlData(row.data) }));
}

async function mysqlSave(table, record) {
  await ensureMysqlReady();
  await mysqlPool.execute(
    `insert into \`${table}\` (id, data, updated_at) values (?, ?, current_timestamp)
     on duplicate key update data = values(data), updated_at = current_timestamp`,
    [record.id, JSON.stringify(record)]
  );
}

async function mysqlDelete(table, idValue) {
  await ensureMysqlReady();
  await mysqlPool.execute(`delete from \`${table}\` where id = ?`, [idValue]);
}

const db = {
  async all(table) {
    assertTable(table);
    if (mysqlPool) return mysqlAll(table);
    if (neonSql) {
      await ensureNeonSchema();
      const rows = await neonAll(table);
      return rows.map((row) => ({ id: row.id, ...(row.data || {}) }));
    }
    if (!supabase) return readLocal(table);
    const { data, error } = await supabase.from(table).select("*");
    if (error) throw error;
    return (data || []).map((row) => ({ id: row.id, ...(row.data || {}) }));
  },
  async save(table, record) {
    assertTable(table);
    if (mysqlPool) {
      await mysqlSave(table, record);
      return record;
    }
    if (neonSql) {
      await ensureNeonSchema();
      await neonSave(table, record);
      return record;
    }
    if (!supabase) {
      const rows = readLocal(table);
      const index = rows.findIndex((row) => row.id === record.id);
      if (index >= 0) rows[index] = record;
      else rows.push(record);
      writeLocal(table, rows);
      return record;
    }
    const { error } = await supabase
      .from(table)
      .upsert({ id: record.id, data: record, updated_at: now() }, { onConflict: "id" });
    if (error) throw error;
    return record;
  },
  async removeWhere(table, predicate) {
    assertTable(table);
    const rows = await this.all(table);
    const remove = rows.filter(predicate);
    if (mysqlPool) {
      for (const row of remove) await mysqlDelete(table, row.id);
      return;
    }
    if (neonSql) {
      await ensureNeonSchema();
      for (const row of remove) await neonDelete(table, row.id);
      return;
    }
    if (!supabase) {
      writeLocal(table, rows.filter((row) => !predicate(row)));
      return;
    }
    for (const row of remove) {
      const { error } = await supabase.from(table).delete().eq("id", row.id);
      if (error) throw error;
    }
  }
};

async function ensureSeed() {
  if (seedDone) return;
  const settings = await db.all("settings");
  if (!settings.find((item) => item.id === "event")) {
    await db.save("settings", {
      id: "event",
      eventName: "Encontrão 25 Anos",
      city: "Campina Grande - PB",
      registrationOpen: true,
      ticketSalesClosed: false,
      ticketPrice: 60,
      socialTicketPrice: 40,
      currentSaleLot: "relampago",
      updatedAt: now()
    });
  }

  if (DEFAULT_ADMIN_EMAIL) {
    const users = await db.all("users");
    const defaultAdmin = users.find((user) => normalizeEmail(user.email) === DEFAULT_ADMIN_EMAIL);
    const legacyAdmin = users.find((user) => user.role === "admin" && !user.email);

    if (defaultAdmin && defaultAdmin.role !== "admin") {
      defaultAdmin.role = "admin";
      defaultAdmin.updatedAt = now();
      await db.save("users", defaultAdmin);
    }

    if (legacyAdmin && !defaultAdmin) {
      legacyAdmin.email = DEFAULT_ADMIN_EMAIL;
      if (DEFAULT_ADMIN_BIRTH_DATE) legacyAdmin.birthDate = DEFAULT_ADMIN_BIRTH_DATE;
      legacyAdmin.updatedAt = now();
      await db.save("users", legacyAdmin);
    } else if (legacyAdmin && defaultAdmin && legacyAdmin.id !== defaultAdmin.id) {
      legacyAdmin.role = "usuarios";
      legacyAdmin.updatedAt = now();
      await db.save("users", legacyAdmin);
    } else if (!defaultAdmin && DEFAULT_ADMIN_BIRTH_DATE) {
      await db.save("users", {
        id: id("usr"),
        name: "Area Exclusiva",
        email: DEFAULT_ADMIN_EMAIL,
        whatsapp: "",
        birthDate: DEFAULT_ADMIN_BIRTH_DATE,
        role: "admin",
        createdAt: now()
      });
    }
  }
  seedDone = true;
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

async function adminUsersWithTicketCounts() {
  const ticketCounts = new Map();
  for (const ticket of await db.all("tickets")) {
    if (!ticket.userId || !isTicketPaid(ticket)) continue;
    ticketCounts.set(ticket.userId, (ticketCounts.get(ticket.userId) || 0) + 1);
  }
  return (await db.all("users")).map((user) => ({
    ...publicUser(user),
    acquiredTicketCount: ticketCounts.get(user.id) || 0
  }));
}

function addUsersWorksheet(workbook, name, users, includeTicketCount) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = [
    { header: "Nome completo", key: "name", width: 38 },
    { header: "Número de telefone", key: "whatsapp", width: 22 },
    { header: "E-mail", key: "email", width: 42 },
    ...(includeTicketCount ? [{ header: "Quantidade de ingressos", key: "acquiredTicketCount", width: 25 }] : [])
  ];
  users.forEach((user) => worksheet.addRow(user));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = { from: "A1", to: includeTicketCount ? "D1" : "C1" };
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003D69" } };
  });
}

function createUsersWorkbook(users) {
  const sortedUsers = [...users].sort((first, second) =>
    String(first.name || "").localeCompare(String(second.name || ""), "pt-BR", { sensitivity: "base" })
  );
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EJD - Credenciamento";
  workbook.created = new Date();
  addUsersWorksheet(workbook, "Com ingressos", sortedUsers.filter((user) => user.acquiredTicketCount > 0), true);
  addUsersWorksheet(workbook, "Sem ingressos", sortedUsers.filter((user) => user.acquiredTicketCount === 0), false);
  return workbook;
}

const saleLotLabels = {
  relampago: "Lote Relâmpago",
  lote2: "1º Lote",
  lote3: "2º Lote",
  lote4: "3º Lote"
};

const saleLotTicketPrices = {
  relampago: { inteiro: 60, meia: 30, social: 40 },
  lote2: { inteiro: 80, meia: 40, social: 50 },
  lote3: { inteiro: 90, meia: 45, social: 55 },
  lote4: { inteiro: 100, meia: 50, social: 60 }
};

function ticketSaleLot(ticket) {
  if (saleLots.has(ticket.saleLot)) return ticket.saleLot;
  const originalPrice = Number(ticket.originalPrice);
  if (originalPrice === 60) return "relampago";
  if (originalPrice === 80) return "lote2";
  if (originalPrice === 90) return "lote3";
  if (originalPrice === 100) return "lote4";
  return null;
}

function createSalesReportWorkbook(tickets) {
  const paidTickets = tickets.filter(isTicketPaid);
  const refundedTickets = tickets.filter((ticket) => ["refunded", "charged_back"].includes(ticket.mercadoPagoStatus));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EJD - Credenciamento";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Ingressos por lote");
  const widths = [24, 12, 12, 12, 12, 16, 16, 16, 18, 18, 18, 20];
  widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });

  worksheet.mergeCells("A1:L1");
  worksheet.getCell("A1").value = "INGRESSOS POR LOTE — EJD 25 ANOS";
  worksheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 34;

  worksheet.mergeCells("A3:A4");
  worksheet.mergeCells("B3:E3");
  worksheet.mergeCells("F3:H3");
  worksheet.mergeCells("I3:K3");
  worksheet.mergeCells("L3:L4");
  worksheet.getCell("A3").value = "Lote";
  worksheet.getCell("B3").value = "Quantidade de ingressos";
  worksheet.getCell("F3").value = "Valor unitário (R$)";
  worksheet.getCell("I3").value = "Valor total por categoria (R$)";
  worksheet.getCell("L3").value = "Valor total do lote (R$)";
  ["B4", "C4", "D4", "F4", "G4", "H4", "I4", "J4", "K4"].forEach((cell, index) => {
    worksheet.getCell(cell).value = ["Inteira", "Meia", "Social", "Inteira", "Meia", "Social", "Inteira", "Meia", "Social"][index];
  });
  worksheet.getCell("E4").value = "Total";

  for (const lot of Object.keys(saleLotLabels)) {
    const lotTickets = paidTickets.filter((ticket) => ticketSaleLot(ticket) === lot);
    const categoryTickets = Object.fromEntries([...ticketTypes].map((type) => [
      type,
      lotTickets.filter((ticket) => (ticketTypes.has(ticket.ticketType) ? ticket.ticketType : "inteiro") === type)
    ]));
    const categoryTotal = (type) => Number(categoryTickets[type].reduce((sum, ticket) => sum + Number(ticket.price || 0), 0).toFixed(2));
    const unitPrice = (type) => categoryTickets[type].length
      ? Number(categoryTickets[type][0].price || 0)
      : saleLotTicketPrices[lot][type];
    worksheet.addRow([
      saleLotLabels[lot],
      categoryTickets.inteiro.length,
      categoryTickets.meia.length,
      categoryTickets.social.length,
      lotTickets.length,
      unitPrice("inteiro"),
      unitPrice("meia"),
      unitPrice("social"),
      categoryTotal("inteiro"),
      categoryTotal("meia"),
      categoryTotal("social"),
      Number(lotTickets.reduce((sum, ticket) => sum + Number(ticket.price || 0), 0).toFixed(2))
    ]);
  }

  const unidentifiedTickets = paidTickets.filter((ticket) => !ticketSaleLot(ticket));
  if (unidentifiedTickets.length) {
    const count = (type) => unidentifiedTickets.filter((ticket) => (ticket.ticketType || "inteiro") === type).length;
    const total = (type) => Number(unidentifiedTickets.filter((ticket) => (ticket.ticketType || "inteiro") === type)
      .reduce((sum, ticket) => sum + Number(ticket.price || 0), 0).toFixed(2));
    worksheet.addRow(["Lote não identificado", count("inteiro"), count("meia"), count("social"), unidentifiedTickets.length, null, null, null,
      total("inteiro"), total("meia"), total("social"), total("inteiro") + total("meia") + total("social")]);
  }

  const totalRow = worksheet.addRow(["TOTAL GERAL", null, null, null, paidTickets.length, null, null, null, null, null, null,
    Number(paidTickets.reduce((sum, ticket) => sum + Number(ticket.price || 0), 0).toFixed(2))]);
  const refundRow = worksheet.addRow(["Ingressos com estorno", refundedTickets.length]);

  worksheet.views = [{ state: "frozen", ySplit: 4 }];
  [1, 3, 4].forEach((rowNumber) => worksheet.getRow(rowNumber).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003D69" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }));
  for (let row = 3; row <= refundRow.number; row += 1) {
    worksheet.getRow(row).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D7DE" } }, bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
        left: { style: "thin", color: { argb: "FFD0D7DE" } }, right: { style: "thin", color: { argb: "FFD0D7DE" } }
      };
    });
  }
  ["F", "G", "H", "I", "J", "K", "L"].forEach((column) => { worksheet.getColumn(column).numFmt = 'R$ #,##0.00'; });
  totalRow.font = { bold: true, color: { argb: "FF003D69" } };
  refundRow.font = { bold: true, color: { argb: "FF8C2441" } };
  return workbook;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    whatsapp: user.whatsapp,
    birthDate: user.birthDate,
    role: user.role || "usuarios"
  };
}

async function getSessionUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sessions = await db.all("sessions");
  const session = sessions.find((item) => item.tokenHash === hash(token) && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const users = await db.all("users");
  const user = users.find((item) => item.id === session.userId);
  return user ? { user, session } : null;
}

function requireRole(auth, roles) {
  if (!auth) return false;
  return roles.includes(auth.user.role || "usuarios");
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.removeWhere("sessions", (session) => session.userId === user.id);
  await db.save("sessions", {
    id: id("ses"),
    userId: user.id,
    tokenHash: hash(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  });
  return token;
}

async function ticketWithQr(ticket) {
  if (!isTicketPaid(ticket)) return ticket;
  const qrPayload = ticket.code;
  return {
    ...ticket,
    qrCode: await QRCode.toDataURL(qrPayload, { width: 360, margin: 2 })
  };
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ticketTypeEmailLabel(ticketType) {
  if (ticketType === "social") return "Ingresso Social";
  if (ticketType === "meia") return "Meia-entrada";
  return "Ingresso Inteiro";
}

function ticketImageText(value, x, y, fontSize, fill, options = {}) {
  const font = options.bold ? ticketFontBold : ticketFontRegular;
  const text = String(value || "");
  const startX = options.center ? x - font.getAdvanceWidth(text, fontSize) / 2 : x;
  return `<path d="${font.getPath(text, startX, y, fontSize).toPathData(2)}" fill="${fill}"/>`;
}

async function createTicketEmailImage(ticket) {
  const qrBuffer = await QRCode.toBuffer(ticket.code, { width: 440, margin: 2, type: "png" });
  const qrDataUrl = `data:image/png;base64,${qrBuffer.toString("base64")}`;
  const eventLogoDataUrl = `data:image/png;base64,${fs.readFileSync(path.join(brandingDir, "trilhos-destinos.png")).toString("base64")}`;
  const anniversaryLogoDataUrl = `data:image/png;base64,${fs.readFileSync(path.join(brandingDir, "ejdbranca.png")).toString("base64")}`;
  const ticketType = ticketTypeEmailLabel(ticket.ticketType);
  const additionalNotice = ticket.ticketType === "social"
    ? "Leve 1 kg de alimento não perecível para entregar na entrada."
    : ticket.ticketType === "meia"
      ? "Leve o documento que comprova o direito à meia-entrada."
      : "Apresente este bilhete na entrada do evento.";
  const svg = `
    <svg width="900" height="1300" viewBox="0 0 900 1300" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="1300" rx="32" fill="#f8fafc"/>
      <rect width="900" height="210" rx="32" fill="#06314f"/>
      <rect y="178" width="900" height="32" fill="#06314f"/>
      <image href="${eventLogoDataUrl}" x="55" y="30" width="110" height="150" preserveAspectRatio="xMidYMid meet"/>
      <rect x="185" y="52" width="2" height="108" fill="#ff9800"/>
      <image href="${anniversaryLogoDataUrl}" x="210" y="42" width="120" height="120" preserveAspectRatio="xMidYMid meet"/>
      ${ticketImageText("EJD - CREDENCIAMENTO", 365, 82, 30, "#ffcf7a", { bold: true })}
      ${ticketImageText("Encontrão 25 Anos", 365, 145, 48, "#ffffff", { bold: true })}
      ${ticketImageText("PARTICIPANTE", 70, 280, 25, "#64748b", { bold: true })}
      ${ticketImageText(ticket.participantName, 70, 330, 36, "#071b33", { bold: true })}
      ${ticketImageText("TIPO DO BILHETE", 70, 410, 25, "#64748b", { bold: true })}
      ${ticketImageText(ticketType, 70, 462, 40, "#071b33", { bold: true })}
      ${ticketImageText("CÓDIGO", 70, 540, 25, "#64748b", { bold: true })}
      ${ticketImageText(ticket.code, 70, 602, 54, "#071b33", { bold: true })}
      <image href="${qrDataUrl}" x="230" y="645" width="440" height="440"/>
      ${ticketImageText("Campina Grande - PB", 450, 1145, 25, "#071b33", { bold: true, center: true })}
      ${ticketImageText(additionalNotice, 450, 1200, 21, "#475569", { center: true })}
      ${ticketImageText("Use o QR Code ou o código acima para o credenciamento.", 450, 1245, 20, "#64748b", { center: true })}
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function sendPurchasedTicketsEmail(tickets) {
  const pendingTickets = tickets.filter((ticket) => isTicketPaid(ticket) && !ticket.emailSentAt);
  if (!pendingTickets.length) return { skipped: true };
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn("E-mail dos ingressos não enviado: configure SMTP_USER e SMTP_PASS.");
    return { skipped: true };
  }

  const users = await db.all("users");
  const user = users.find((item) => item.id === pendingTickets[0].userId);
  const recipient = normalizeEmail(user?.email || pendingTickets[0].participantEmail);
  if (!isValidEmail(recipient)) throw new Error("O comprador não possui um e-mail válido.");

  const attachments = await Promise.all(pendingTickets.map(async (ticket, index) => ({
    filename: `ingresso-${index + 1}-${ticket.code}.png`,
    content: await createTicketEmailImage(ticket),
    contentType: "image/png"
  })));
  const emailKey = hash(pendingTickets.map((ticket) => ticket.id).sort().join("|")).slice(0, 48);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  const result = await transporter.sendMail({
    from: { name: "Encontrão EJD 2025", address: SMTP_USER },
    to: recipient,
    subject: `${pendingTickets.length === 1 ? "Seu ingresso" : "Seus ingressos"} - Encontrão 25 Anos`,
    html: `<h1>Pagamento confirmado!</h1><p>Olá, ${escapeXml(user?.name || pendingTickets[0].participantName)}.</p><p>${pendingTickets.length === 1 ? "Seu ingresso está anexado" : "Seus ingressos estão anexados"} a este e-mail. Guarde ${pendingTickets.length === 1 ? "a imagem" : "as imagens"} e apresente o QR Code na entrada do evento.</p>`,
    attachments,
    messageId: `<ejd-tickets-${emailKey}@gmail.com>`
  });

  const sentAt = now();
  for (const ticket of pendingTickets) {
    ticket.emailSentAt = sentAt;
    ticket.emailMessageId = result.messageId || null;
    ticket.emailLastError = null;
    ticket.updatedAt = sentAt;
    await db.save("tickets", ticket);
  }
  console.log(`Ingressos enviados por e-mail: ${pendingTickets.length}; mensagem: ${result.messageId || "sem-id"}.`);
  return { sent: true, id: result.messageId };
}

async function trySendPurchasedTicketsEmail(tickets) {
  try {
    return await sendPurchasedTicketsEmail(tickets);
  } catch (error) {
    console.error("Falha ao enviar ingressos por e-mail:", error.message);
    const failedAt = now();
    for (const ticket of tickets.filter((item) => isTicketPaid(item) && !item.emailSentAt)) {
      ticket.emailLastError = error.message;
      ticket.emailLastAttemptAt = failedAt;
      await db.save("tickets", ticket);
    }
    return { sent: false, error: error.message };
  }
}

function mercadoPagoErrorMessage(data, fallback) {
  const cause = Array.isArray(data?.cause) ? data.cause : [];
  const details = cause
    .map((item) => item?.description || item?.message || item?.code)
    .filter(Boolean)
    .join(" ");
  return details || data?.message || data?.error || fallback;
}

function isTemporaryMercadoPagoError(statusCode) {
  return !statusCode || statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

async function mercadoPagoRequest(url, options = {}, requestOptions = {}) {
  const retries = Math.max(Number(requestOptions.retries || 0), 0);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MERCADO_PAGO_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      let data;
      try {
        if (typeof response.text === "function") {
          const rawBody = await response.text();
          data = rawBody ? JSON.parse(rawBody) : {};
        } else {
          data = await response.json();
        }
      } catch {
        const invalidJsonError = new Error("O Mercado Pago retornou uma resposta inválida.");
        invalidJsonError.statusCode = response.status;
        invalidJsonError.retryable = true;
        throw invalidJsonError;
      }

      if (!response.ok) {
        const requestError = new Error(mercadoPagoErrorMessage(data, `Mercado Pago respondeu HTTP ${response.status}.`));
        requestError.statusCode = response.status;
        requestError.retryable = isTemporaryMercadoPagoError(response.status);
        throw requestError;
      }
      return data;
    } catch (error) {
      const normalizedError = error.name === "AbortError"
        ? Object.assign(new Error(`Tempo limite de ${MERCADO_PAGO_TIMEOUT_MS} ms excedido ao consultar o Mercado Pago.`), { retryable: true })
        : error;
      if (normalizedError.retryable === undefined && !normalizedError.statusCode) normalizedError.retryable = true;
      lastError = normalizedError;
      if (attempt >= retries || !normalizedError.retryable) throw normalizedError;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchMercadoPagoPayment(paymentId, options = {}) {
  if (!MP_TOKEN) throw new Error("MERCADO_PAGO_ACCESS_TOKEN não configurado.");
  const normalizedPaymentId = String(paymentId || "").trim();
  if (!/^\d+$/.test(normalizedPaymentId)) throw new Error("payment_id inválido.");

  return mercadoPagoRequest(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(normalizedPaymentId)}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  }, { retries: options.retries === undefined ? 1 : options.retries });
}

async function applyMercadoPagoPayment(payment, options = {}) {
  const paymentId = String(payment?.id || options.paymentId || "").trim();
  const reference = String(payment?.external_reference || "").trim();
  const paymentStatus = String(payment?.status || "").trim();
  if (!paymentId || !paymentStatus) throw new Error("Resposta de pagamento incompleta do Mercado Pago.");

  const storage = options.storage || db;
  const tickets = await storage.all("tickets");
  const relatedTickets = tickets.filter((ticket) => (
    String(ticket.paymentId || "") === paymentId
    || (reference && (String(ticket.orderId || "") === reference || String(ticket.id || "") === reference))
  ));
  const statusUpdatedAt = now();
  let updatedCount = 0;
  let newlyApprovedCount = 0;

  for (const ticket of relatedTickets) {
    const wasPaid = isTicketPaid(ticket);
    const wasManuallyConfirmed = ticket.mercadoPagoStatus === "manual" && ticket.status === "confirmed";

    ticket.paymentId = paymentId;
    ticket.mercadoPagoStatusDetail = payment.status_detail || null;
    ticket.mercadoPagoStatusUpdatedAt = statusUpdatedAt;
    if (payment.date_of_expiration) ticket.paymentExpiresAt = payment.date_of_expiration;
    const pixTransactionData = payment.point_of_interaction?.transaction_data;
    if (pixTransactionData) {
      if (pixTransactionData.qr_code) ticket.pixQrCode = pixTransactionData.qr_code;
      if (pixTransactionData.qr_code_base64) ticket.pixQrCodeBase64 = pixTransactionData.qr_code_base64;
      if (pixTransactionData.ticket_url) ticket.pixTicketUrl = pixTransactionData.ticket_url;
    }

    if (paymentStatus === "approved") {
      ticket.mercadoPagoStatus = "approved";
      ticket.status = "confirmed";
      ticket.confirmedAt = payment.date_approved || ticket.confirmedAt || statusUpdatedAt;
      ticket.paidAt = payment.date_approved || ticket.paidAt || ticket.confirmedAt;
      ticket.manualConfirmedBy = null;
      ticket.manualConfirmedByName = null;
      if (!wasPaid) newlyApprovedCount += 1;
    } else if (wasManuallyConfirmed) {
      // Uma atualização automática não deve desfazer uma baixa manual existente.
      ticket.mercadoPagoStatus = "manual";
    } else {
      ticket.mercadoPagoStatus = paymentStatus;
      ticket.status = "pending";
    }

    ticket.updatedAt = statusUpdatedAt;
    await storage.save("tickets", ticket);
    updatedCount += 1;
  }

  let emailResult = { skipped: true };
  const hasUnsentApprovedTickets = relatedTickets.some((ticket) => isTicketPaid(ticket) && !ticket.emailSentAt);
  if (paymentStatus === "approved" && hasUnsentApprovedTickets && options.sendEmail !== false) {
    const emailSender = options.emailSender || trySendPurchasedTicketsEmail;
    emailResult = await emailSender(relatedTickets);
  }

  return { paymentId, reference, paymentStatus, relatedTickets, updatedCount, newlyApprovedCount, emailResult };
}

async function synchronizeMercadoPagoPayment(paymentId, options = {}) {
  return withMercadoPagoPaymentLock(paymentId, async () => {
    const payment = await fetchMercadoPagoPayment(paymentId, { retries: options.apiRetries });
    const result = await applyMercadoPagoPayment(payment, { ...options, paymentId });
    mercadoPagoLog("pagamento sincronizado", {
      origin: options.origin || "unknown",
      paymentId: result.paymentId,
      externalReference: result.reference || null,
      status: result.paymentStatus,
      statusDetail: payment.status_detail || null,
      ticketsUpdated: result.updatedCount
    });
    return result;
  });
}

async function sendMercadoPagoTicketsEmail(paymentId, ticketIds, origin) {
  return withMercadoPagoPaymentLock(paymentId, async () => {
    const idSet = new Set(ticketIds);
    const latestTickets = (await db.all("tickets")).filter((ticket) => idSet.has(ticket.id));
    const result = await trySendPurchasedTicketsEmail(latestTickets);
    mercadoPagoLog("resultado do e-mail", {
      origin,
      paymentId: String(paymentId),
      tickets: latestTickets.length,
      sent: Boolean(result?.sent),
      skipped: Boolean(result?.skipped),
      error: result?.error || null
    });
    return result;
  });
}

async function synchronizeWaitingTickets(tickets) {
  if (!MP_TOKEN) return;
  const paymentIds = [...new Set(tickets
    .filter((ticket) => isMercadoPagoWaiting(ticket) && ticket.paymentId)
    .map((ticket) => String(ticket.paymentId)))];

  for (const paymentId of paymentIds) {
    try {
      await synchronizeMercadoPagoPayment(paymentId, { sendEmail: false, origin: "api/me" });
    } catch (error) {
      console.warn(`[Mercado Pago] Não foi possível sincronizar o pagamento ${paymentId}: ${error.message}`);
    }
  }
}

function mercadoPagoPayerEmail(user) {
  return normalizeEmail(user?.email);
}

function mercadoPagoPixResponse(data) {
  const transactionData = data?.point_of_interaction?.transaction_data || {};
  return {
    id: String(data?.id || ""),
    status: data?.status || "pending",
    statusDetail: data?.status_detail || null,
    dateApproved: data?.date_approved || null,
    expiresAt: data?.date_of_expiration || null,
    qrCode: transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
    ticketUrl: transactionData.ticket_url
  };
}

function mercadoPagoPixDescription(user, ticketItems) {
  const typeLabels = { inteiro: "inteira", meia: "meia", social: "social" };
  const purchase = (Array.isArray(ticketItems) ? ticketItems : [])
    .map((item) => `${item.quantity}x ${typeLabels[item.ticketType] || item.ticketType}`)
    .join(", ");
  return `${user.name || "Usuário"} | ${user.whatsapp || "sem telefone"} | ${purchase || "ingresso"}`.slice(0, 256);
}

async function createMercadoPagoPixPayment(user, orderId, quantity, total, ticketItems) {
  if (!MP_TOKEN) return null;
  const transactionAmount = Number(Number(total).toFixed(2));
  const data = await mercadoPagoRequest("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderId
    },
    body: JSON.stringify({
      transaction_amount: transactionAmount,
      description: mercadoPagoPixDescription(user, ticketItems),
      payment_method_id: "pix",
      external_reference: orderId,
      notification_url: `${APP_URL}/webhook/mercadopago`,
      payer: {
        email: mercadoPagoPayerEmail(user),
        first_name: user.name
      }
    })
  }, { retries: 1 });
  return mercadoPagoPixResponse(data);
}

async function createMercadoPagoCardPayment(user, orderId, total, cardPayment, ticketItems) {
  if (!MP_TOKEN) return null;
  const token = String(cardPayment?.token || "").trim();
  const paymentMethodId = String(cardPayment?.paymentMethodId || "").trim();
  const issuerId = String(cardPayment?.issuerId || "").trim();
  const installments = Math.min(Math.max(Number.parseInt(cardPayment?.installments, 10) || 1, 1), 3);
  const payerEmail = normalizeEmail(cardPayment?.payer?.email || user.email);
  const identificationType = String(cardPayment?.payer?.identification?.type || "CPF").trim();
  const identificationNumber = cleanDigits(cardPayment?.payer?.identification?.number);
  const deviceId = String(cardPayment?.deviceId || "").trim().slice(0, 256);
  const cardholderName = String(cardPayment?.cardholderName || user.name || "").trim();
  if (!token || !paymentMethodId || !isValidEmail(payerEmail) || !identificationNumber) {
    throw new Error("Confira os dados do cartão e do titular.");
  }

  const nameParts = cardholderName.split(/\s+/).filter(Boolean);
  const firstName = nameParts.shift() || "Comprador";
  const lastName = nameParts.join(" ");
  const phoneDigits = cleanDigits(user.whatsapp);
  const areaCode = phoneDigits.length >= 10 ? phoneDigits.slice(0, 2) : "";
  const phoneNumber = phoneDigits.length >= 10 ? phoneDigits.slice(2) : phoneDigits;
  const additionalItems = (Array.isArray(ticketItems) ? ticketItems : []).map((item) => ({
    id: `ingresso-${item.ticketType}`,
    title: `Ingresso ${item.ticketType} - Encontrão 25 Anos`,
    description: "Ingresso para evento presencial",
    category_id: "tickets",
    quantity: Number(item.quantity),
    unit_price: Number(item.unitPrice)
  }));

  return mercadoPagoRequest("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderId,
      ...(deviceId ? { "X-meli-session-id": deviceId } : {})
    },
    body: JSON.stringify({
      transaction_amount: Number(total),
      token,
      description: "Ingresso - Encontrão 25 Anos",
      installments,
      payment_method_id: paymentMethodId,
      ...(issuerId ? { issuer_id: issuerId } : {}),
      external_reference: orderId,
      notification_url: `${APP_URL}/webhook/mercadopago`,
      three_d_secure_mode: "optional",
      capture: true,
      binary_mode: false,
      payer: {
        email: payerEmail,
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
        ...(phoneNumber ? { phone: { area_code: areaCode, number: phoneNumber } } : {}),
        identification: {
          type: identificationType,
          number: identificationNumber
        }
      },
      additional_info: {
        ...(additionalItems.length ? { items: additionalItems } : {}),
        payer: {
          first_name: firstName,
          ...(lastName ? { last_name: lastName } : {}),
          ...(phoneNumber ? { phone: { area_code: areaCode, number: phoneNumber } } : {}),
          ...(user.createdAt ? { registration_date: user.createdAt } : {})
        }
      }
    })
  }, { retries: 1 });
}

async function api(req, res, pathname) {
  await ensureSeed();
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await parseBody(req) : {};
  const auth = await getSessionUser(req);

  if (pathname === "/api/config" && req.method === "GET") {
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    return send(res, 200, {
      settings: {
        ...settings,
        socialTicketPrice: numberOrDefault(settings?.socialTicketPrice, settings?.ticketPrice),
        currentSaleLot: saleLots.has(settings?.currentSaleLot) ? settings.currentSaleLot : "relampago",
        ticketSalesClosed: Boolean(settings?.ticketSalesClosed)
      },
      paymentConfigured: Boolean(MP_TOKEN),
      mercadoPagoPublicKey: MP_PUBLIC_KEY,
      ticketEmailConfigured: Boolean(SMTP_USER && SMTP_PASS)
    });
  }

  if (pathname === "/api/register" && req.method === "POST") {
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    if (!settings.registrationOpen) return send(res, 403, { message: "Cadastro fechado." });
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const whatsapp = cleanDigits(body.whatsapp);
    const birthDate = cleanDigits(body.birthDate);
    if (!name || !isValidEmail(email) || whatsapp.length !== 11 || birthDate.length !== 8) {
      return send(res, 400, { message: "Preencha nome, e-mail, WhatsApp e nascimento corretamente." });
    }
    const users = await db.all("users");
    if (users.find((user) => normalizeEmail(user.email) === email)) {
      return send(res, 409, { message: "Já existe uma conta cadastrada com esse e-mail." });
    }
    const user = {
      id: id("usr"),
      name,
      email,
      whatsapp,
      birthDate,
      role: "usuarios",
      createdAt: now()
    };
    await db.save("users", user);
    const token = await createSession(user);
    return send(res, 201, { token, user: publicUser(user) });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const email = normalizeEmail(body.email);
    const birthDate = cleanDigits(body.birthDate);
    if (!isValidEmail(email) || birthDate.length !== 8) {
      return send(res, 400, { message: "Informe o e-mail e a data de nascimento corretamente." });
    }
    const users = await db.all("users");
    const user = users.find((item) => normalizeEmail(item.email) === email && item.birthDate === birthDate);
    if (!user) return send(res, 401, { message: "Credenciais inválidas." });
    const token = await createSession(user);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    if (!auth) return send(res, 401, { message: "Sessão inválida." });
    const userTickets = (await db.all("tickets")).filter((ticket) => ticket.userId === auth.user.id);
    await synchronizeWaitingTickets(userTickets);
    const tickets = (await db.all("tickets")).filter((ticket) => ticket.userId === auth.user.id && !isExpiredPendingTicket(ticket));
    await trySendPurchasedTicketsEmail(tickets);
    const withQr = await Promise.all(tickets.map(ticketWithQr));
    return send(res, 200, { user: publicUser(auth.user), tickets: withQr });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    if (auth) await db.removeWhere("sessions", (session) => session.id === auth.session.id);
    return send(res, 200, { ok: true });
  }

  const ticketEmailMatch = pathname.match(/^\/api\/tickets\/([^/]+)\/email$/);
  if (ticketEmailMatch && req.method === "POST") {
    if (!auth) return send(res, 401, { message: "Sessão inválida." });
    const allTickets = await db.all("tickets");
    const selectedTicket = allTickets.find((ticket) => ticket.id === ticketEmailMatch[1] && ticket.userId === auth.user.id);
    if (!selectedTicket || !isTicketPaid(selectedTicket)) return send(res, 404, { message: "Ingresso confirmado não encontrado." });
    const orderTickets = allTickets.filter((ticket) => ticket.userId === auth.user.id && ticket.orderId === selectedTicket.orderId && isTicketPaid(ticket));
    for (const ticket of orderTickets) {
      ticket.emailSentAt = null;
      ticket.emailMessageId = null;
      ticket.emailLastError = null;
      ticket.updatedAt = now();
      await db.save("tickets", ticket);
    }
    const result = await trySendPurchasedTicketsEmail(orderTickets);
    if (!result.sent) return send(res, 502, { message: result.error || "Não foi possível enviar o e-mail." });
    return send(res, 200, { message: "Ingressos enviados por e-mail com sucesso. Verifique também as pastas Spam e Lixo eletrônico." });
  }

  if (pathname === "/api/tickets/checkout" && req.method === "POST") {
    if (!auth) return send(res, 401, { message: "Sessão inválida." });
    const checkoutRequestId = String(body.checkoutRequestId || "").trim();
    if (checkoutRequestId && !/^[A-Za-z0-9_-]{8,100}$/.test(checkoutRequestId)) {
      return send(res, 400, { message: "Identificador de checkout inválido." });
    }
    const checkoutLockKey = checkoutRequestId ? `${auth.user.id}:${checkoutRequestId}` : "";
    if (checkoutLockKey && mercadoPagoCheckoutRequests.has(checkoutLockKey)) {
      return send(res, 409, { message: "Este pagamento já está sendo processado. Aguarde e tente atualizar a página." });
    }
    if (checkoutLockKey) {
      mercadoPagoCheckoutRequests.add(checkoutLockKey);
      res.once("finish", () => mercadoPagoCheckoutRequests.delete(checkoutLockKey));
      res.once("close", () => mercadoPagoCheckoutRequests.delete(checkoutLockKey));
    }
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    if (settings.ticketSalesClosed) return send(res, 403, { message: "Venda de ingressos fechada." });
    const paymentMethod = body.paymentMethod === "credit_card" ? "credit_card" : "pix";
    const unitPrice = Number(settings.ticketPrice || 0);
    const ticketTypePrices = {
      inteiro: unitPrice,
      meia: Number((unitPrice * ticketTypeDiscounts.meia).toFixed(2)),
      social: numberOrDefault(settings.socialTicketPrice, unitPrice)
    };
    const requestedItems = body.items && typeof body.items === "object"
      ? body.items
      : { [ticketTypes.has(body.ticketType) ? body.ticketType : "inteiro"]: body.quantity };
    const ticketItems = [...ticketTypes].map((ticketType) => ({
      ticketType,
      quantity: Math.max(Number.parseInt(requestedItems[ticketType], 10) || 0, 0),
      unitPrice: ticketTypePrices[ticketType]
    })).filter((item) => item.quantity > 0);
    const quantity = ticketItems.reduce((sum, item) => sum + item.quantity, 0);
    if (quantity < 1) return send(res, 400, { message: "Selecione pelo menos 1 ingresso." });
    if (quantity > 20) return send(res, 400, { message: "Selecione no máximo 20 ingressos por compra." });
    const subtotal = Number(ticketItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
    const serviceFeeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
    const serviceFee = Number((subtotal * serviceFeeRate).toFixed(2));
    const total = Number((subtotal + serviceFee).toFixed(2));
    const orderId = checkoutRequestId
      ? `ord_${hash(`${auth.user.id}:${checkoutRequestId}`).slice(0, 40)}`
      : id("ord");
    const allTickets = await db.all("tickets");
    const existingOrderTickets = allTickets.filter((ticket) => ticket.userId === auth.user.id && ticket.orderId === orderId);
    if (existingOrderTickets.length) {
      const existingPaymentId = existingOrderTickets.find((ticket) => ticket.paymentId)?.paymentId;
      if (!existingPaymentId) return send(res, 409, { message: "Pedido existente ainda sem pagamento. Aguarde e atualize a página." });
      try {
        const payment = await fetchMercadoPagoPayment(existingPaymentId);
        await applyMercadoPagoPayment(payment, { origin: "checkout-retry" });
        mercadoPagoLog("checkout reutilizado", {
          origin: "checkout",
          paymentId: String(payment.id),
          externalReference: payment.external_reference || orderId,
          status: payment.status,
          statusDetail: payment.status_detail || null,
          ticketsUpdated: existingOrderTickets.length
        });
        return send(res, 200, {
          tickets: existingOrderTickets,
          quantity,
          subtotal,
          serviceFee,
          total,
          items: ticketItems,
          paymentMethod,
          pix: paymentMethod === "pix" ? mercadoPagoPixResponse(payment) : null,
          cardPayment: paymentMethod === "credit_card" ? {
            id: String(payment.id),
            status: payment.status,
            statusDetail: payment.status_detail || null,
            threeDSInfo: payment.three_ds_info ? {
              externalResourceUrl: payment.three_ds_info.external_resource_url,
              creq: payment.three_ds_info.creq
            } : null
          } : null,
          message: "Pagamento existente recuperado."
        });
      } catch (error) {
        console.warn("[Mercado Pago] Falha ao recuperar checkout existente:", {
          origin: "checkout-retry",
          paymentId: String(existingPaymentId),
          error: error.message,
          statusCode: error.statusCode || null
        });
        return send(res, 503, { message: "O pagamento já foi criado, mas ainda não foi possível consultar seu estado. Atualize a página em instantes." });
      }
    }
    const usedCodes = new Set(allTickets.map((ticket) => ticket.code));
    const tickets = ticketItems.flatMap((item) => Array.from({ length: item.quantity }, () => ({
      id: checkoutRequestId
        ? `tkt_${hash(`${orderId}:${item.ticketType}:${usedCodes.size}`).slice(0, 40)}`
        : id("tkt"),
      orderId,
      userId: auth.user.id,
      participantName: auth.user.name,
      participantWhatsapp: auth.user.whatsapp,
      participantEmail: auth.user.email,
      status: "pending",
      mercadoPagoStatus: "pending",
      ticketType: item.ticketType,
      saleLot: saleLots.has(settings.currentSaleLot) ? settings.currentSaleLot : "relampago",
      originalPrice: unitPrice,
      price: item.unitPrice,
      serviceFee: Number((item.unitPrice * serviceFeeRate).toFixed(2)),
      paymentMethod,
      code: createTicketCode(usedCodes),
      checkinAt: null,
      paymentId: null,
      createdAt: now(),
      updatedAt: now()
    })));
    let pix = null;
    let cardPayment = null;
    try {
      if (paymentMethod === "pix") {
        pix = await createMercadoPagoPixPayment(auth.user, orderId, quantity, total, ticketItems);
        if (!pix) return send(res, 400, { message: "Mercado Pago nao configurado para gerar Pix." });
        if (pix) {
          for (const ticket of tickets) {
            ticket.paymentId = pix.id;
            ticket.mercadoPagoStatus = pix.status || "pending";
            ticket.mercadoPagoStatusDetail = pix.statusDetail;
            ticket.mercadoPagoStatusUpdatedAt = now();
            ticket.paymentExpiresAt = pix.expiresAt;
            ticket.pixQrCode = pix.qrCode || null;
            ticket.pixQrCodeBase64 = pix.qrCodeBase64 || null;
            ticket.pixTicketUrl = pix.ticketUrl || null;
            if (pix.status === "approved") {
              ticket.status = "confirmed";
              ticket.confirmedAt = pix.dateApproved || now();
              ticket.paidAt = ticket.confirmedAt;
            }
          }
        }
      } else {
        cardPayment = await createMercadoPagoCardPayment(auth.user, orderId, total, body.cardPayment, ticketItems);
      }
    } catch (error) {
      return send(res, 502, { message: error.message || "Falha ao solicitar pagamento no Mercado Pago." });
    }
    if (cardPayment) {
      for (const ticket of tickets) {
        ticket.paymentId = String(cardPayment.id);
        ticket.mercadoPagoStatus = cardPayment.status;
        ticket.mercadoPagoStatusDetail = cardPayment.status_detail || null;
        ticket.mercadoPagoStatusUpdatedAt = now();
        if (cardPayment.status === "approved") {
          ticket.status = "confirmed";
          ticket.confirmedAt = cardPayment.date_approved || now();
          ticket.paidAt = ticket.confirmedAt;
        }
      }
    }
    for (const ticket of tickets) await db.save("tickets", ticket);
    mercadoPagoLog("checkout criado", {
      origin: "checkout",
      paymentId: String(pix?.id || cardPayment?.id || "") || null,
      externalReference: orderId,
      status: pix?.status || cardPayment?.status || null,
      statusDetail: pix?.statusDetail || cardPayment?.status_detail || null,
      ticketsUpdated: tickets.length
    });
    if (cardPayment?.status === "approved" || pix?.status === "approved") await trySendPurchasedTicketsEmail(tickets);
    return send(res, 201, {
      tickets,
      quantity,
      subtotal,
      serviceFee,
      total,
      items: ticketItems,
      paymentMethod,
      pix,
        cardPayment: cardPayment ? {
          id: String(cardPayment.id),
          status: cardPayment.status,
          statusDetail: cardPayment.status_detail || null,
          threeDSInfo: cardPayment.three_ds_info ? {
            externalResourceUrl: cardPayment.three_ds_info.external_resource_url,
            creq: cardPayment.three_ds_info.creq
          } : null
      } : null,
      message: cardPayment || pix ? "Pagamento criado." : "Pagamento aguardando configuração do Mercado Pago."
    });
  }

  if (pathname === "/api/checkin/validate" && req.method === "POST") {
    if (!requireRole(auth, ["checkin", "admin"])) return send(res, 403, { message: "Acesso negado." });
    const rawValue = String(body.value || "").trim().toUpperCase();
    const phoneValue = cleanDigits(body.value);
    const tickets = await db.all("tickets");
    let ticket = tickets.find((item) => item.code === rawValue);
    if (!ticket && phoneValue.length >= 10) ticket = tickets.find((item) => item.participantWhatsapp === phoneValue);
    if (!ticket) return send(res, 404, { message: "Ingresso não encontrado." });
    if (ticket.status !== "confirmed") return send(res, 409, { message: "Ingresso ainda não está confirmado." });
    if (ticket.checkinAt) return send(res, 409, { message: `Check-in já realizado em ${new Date(ticket.checkinAt).toLocaleString("pt-BR")}.` });
    if (ticket.ticketType === "social" && body.socialFoodDelivered !== true) {
      return send(res, 202, { requiresSocialFoodConfirmation: true, ticket });
    }
    if (ticket.ticketType === "meia" && body.meiaProofPresented !== true) {
      return send(res, 202, { requiresMeiaProofConfirmation: true, ticket });
    }
    ticket.checkinAt = now();
    ticket.checkedBy = auth.user.id;
    if (ticket.ticketType === "social") ticket.socialFoodDelivered = true;
    if (ticket.ticketType === "meia") ticket.meiaProofPresented = true;
    ticket.updatedAt = now();
    await db.save("tickets", ticket);
    return send(res, 200, { message: "Check-in realizado com sucesso.", ticket });
  }

  if (pathname === "/api/admin/summary" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const allTickets = await db.all("tickets");
    const tickets = allTickets.filter((ticket) => !isExpiredPendingTicket(ticket));
    const users = await db.all("users");
    const usersById = new Map(users.map((user) => [user.id, publicUser(user)]));
    const paymentHistoryByPerson = allTickets.reduce((people, ticket) => {
      const personKey = ticket.userId || String(ticket.participantWhatsapp || "").replace(/\D/g, "") || ticket.id;
      const orders = people.get(personKey) || new Map();
      const orderKey = ticket.orderId || ticket.paymentId || ticket.id;
      const current = orders.get(orderKey) || {
        orderId: ticket.orderId || null,
        paymentId: ticket.paymentId || null,
        paymentMethod: ticket.paymentMethod || null,
        mercadoPagoStatus: ticket.mercadoPagoStatus || ticket.status || "pending",
        mercadoPagoStatusDetail: ticket.mercadoPagoStatusDetail || null,
        createdAt: ticket.createdAt || null,
        updatedAt: ticket.mercadoPagoStatusUpdatedAt || ticket.updatedAt || ticket.createdAt || null,
        confirmedAt: ticket.confirmedAt || null,
        paidAt: ticket.paidAt || null,
        paymentExpiresAt: ticket.paymentExpiresAt || null,
        manualConfirmedByName: ticket.manualConfirmedBy ? usersById.get(ticket.manualConfirmedBy)?.name || "Usuário removido" : null,
        quantity: 0,
        total: 0,
        ticketTypes: new Set()
      };
      const ticketActivityAt = ticket.mercadoPagoStatusUpdatedAt || ticket.updatedAt || ticket.createdAt;
      if (new Date(ticketActivityAt || 0).getTime() >= new Date(current.updatedAt || 0).getTime()) {
        current.paymentId = ticket.paymentId || current.paymentId;
        current.paymentMethod = ticket.paymentMethod || current.paymentMethod;
        current.mercadoPagoStatus = ticket.mercadoPagoStatus || ticket.status || current.mercadoPagoStatus;
        current.mercadoPagoStatusDetail = ticket.mercadoPagoStatusDetail || null;
        current.updatedAt = ticketActivityAt || current.updatedAt;
        current.confirmedAt = ticket.confirmedAt || current.confirmedAt;
        current.paidAt = ticket.paidAt || current.paidAt;
        current.paymentExpiresAt = ticket.paymentExpiresAt || current.paymentExpiresAt;
        current.manualConfirmedByName = ticket.manualConfirmedBy
          ? usersById.get(ticket.manualConfirmedBy)?.name || "Usuário removido"
          : current.manualConfirmedByName;
      }
      current.quantity += 1;
      current.total += Number(ticket.price || 0) + Number(ticket.serviceFee || 0);
      current.ticketTypes.add(ticket.ticketType || "inteiro");
      orders.set(orderKey, current);
      people.set(personKey, orders);
      return people;
    }, new Map());
    const normalizedPaymentHistoryByPerson = new Map([...paymentHistoryByPerson].map(([personKey, orders]) => [
      personKey,
      [...orders.values()].map((attempt) => ({
        ...attempt,
        total: Number(attempt.total.toFixed(2)),
        ticketTypes: [...attempt.ticketTypes]
      })).sort((first, second) => new Date(second.updatedAt || second.createdAt || 0).getTime() - new Date(first.updatedAt || first.createdAt || 0).getTime())
    ]));
    const purchasesByOrder = tickets.reduce((purchases, ticket) => {
      const orderKey = ticket.orderId || ticket.id;
      const purchase = purchases.get(orderKey) || { quantity: 0, paidTotal: 0 };
      purchase.quantity += 1;
      if (isTicketPaid(ticket)) {
        purchase.paidTotal += Number(ticket.price || 0) + Number(ticket.serviceFee || 0);
      }
      purchases.set(orderKey, purchase);
      return purchases;
    }, new Map());
    const enrichedTickets = tickets.map((ticket) => ({
      ...ticket,
      manualConfirmedByName: ticket.manualConfirmedBy ? usersById.get(ticket.manualConfirmedBy)?.name || "Usuário removido" : null,
      purchaseQuantity: purchasesByOrder.get(ticket.orderId || ticket.id)?.quantity || 1,
      purchasePaidTotal: Number((purchasesByOrder.get(ticket.orderId || ticket.id)?.paidTotal || 0).toFixed(2))
    })).sort((first, second) => {
      const firstPaidAt = first.paidAt || first.confirmedAt;
      const secondPaidAt = second.paidAt || second.confirmedAt;

      if (!firstPaidAt && !secondPaidAt) return 0;
      if (!firstPaidAt) return 1;
      if (!secondPaidAt) return -1;

      return new Date(secondPaidAt).getTime() - new Date(firstPaidAt).getTime();
    });
    const ticketGroups = enrichedTickets.reduce((groups, ticket) => {
      const personKey = ticket.userId || String(ticket.participantWhatsapp || "").replace(/\D/g, "") || ticket.id;
      const group = groups.get(personKey) || [];
      group.push(ticket);
      groups.set(personKey, group);
      return groups;
    }, new Map());
    const groupedTickets = [...ticketGroups.values()].map((personTickets) => {
      const byActivity = [...personTickets].sort((first, second) => {
        const firstAt = first.mercadoPagoStatusUpdatedAt || first.updatedAt || first.createdAt;
        const secondAt = second.mercadoPagoStatusUpdatedAt || second.updatedAt || second.createdAt;
        return new Date(secondAt || 0).getTime() - new Date(firstAt || 0).getTime();
      });
      const latestTicket = byActivity[0];
      const paidPersonTickets = personTickets.filter(isTicketPaid);
      const latestPaidTicket = byActivity.find(isTicketPaid);
      const rejectedPayments = [...byActivity.reduce((payments, ticket) => {
        if (ticket.mercadoPagoStatus !== "rejected") return payments;
        const paymentKey = ticket.orderId || ticket.paymentId || ticket.id;
        if (!payments.has(paymentKey)) payments.set(paymentKey, ticket);
        return payments;
      }, new Map()).values()];
      const latestRejectedTicket = rejectedPayments[0];

      return {
        ...latestTicket,
        paidAt: latestPaidTicket?.paidAt || latestPaidTicket?.confirmedAt || null,
        confirmedAt: latestPaidTicket?.confirmedAt || null,
        manualConfirmedByName: latestPaidTicket?.manualConfirmedByName || null,
        purchaseQuantity: paidPersonTickets.length,
        purchasePaidTotal: Number(paidPersonTickets.reduce((total, ticket) => (
          total + Number(ticket.price || 0) + Number(ticket.serviceFee || 0)
        ), 0).toFixed(2)),
        hasPaidTickets: paidPersonTickets.length > 0,
        rejectedAt: latestRejectedTicket?.mercadoPagoStatusUpdatedAt || latestRejectedTicket?.updatedAt || null,
        rejectedCount: rejectedPayments.length,
        latestRejectedTicketId: latestRejectedTicket?.id || null,
        checkinCount: paidPersonTickets.filter((ticket) => ticket.checkinAt).length,
        paymentHistory: normalizedPaymentHistoryByPerson.get(
          latestTicket.userId || String(latestTicket.participantWhatsapp || "").replace(/\D/g, "") || latestTicket.id
        ) || []
      };
    }).sort((first, second) => {
      const firstAt = first.paidAt || first.rejectedAt || first.updatedAt || first.createdAt;
      const secondAt = second.paidAt || second.rejectedAt || second.updatedAt || second.createdAt;
      return new Date(secondAt || 0).getTime() - new Date(firstAt || 0).getTime();
    });
    const paidTickets = tickets.filter(isTicketPaid);
    const soldByType = paidTickets.reduce((totals, ticket) => {
      const ticketType = ticket.ticketType || "inteiro";
      totals[ticketType] = (totals[ticketType] || 0) + 1;
      return totals;
    }, { inteiro: 0, meia: 0, social: 0 });
    const receivedTotal = Number(paidTickets.reduce((sum, ticket) => sum + Number(ticket.price || 0), 0).toFixed(2));
    return send(res, 200, {
      paid: paidTickets.length,
      pending: tickets.filter((ticket) => !isTicketPaid(ticket) && isMercadoPagoWaiting(ticket)).length,
      present: tickets.filter((ticket) => ticket.checkinAt).length,
      users: users.length,
      soldByType,
      receivedTotal,
      tickets: groupedTickets
    });
  }

  if (pathname === "/api/admin/settings" && req.method === "PUT") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const current = (await db.all("settings")).find((item) => item.id === "event");
    const settings = {
      ...current,
      ticketPrice: numberOrDefault(body.ticketPrice, current.ticketPrice),
      socialTicketPrice: numberOrDefault(body.socialTicketPrice, current.socialTicketPrice ?? current.ticketPrice),
      currentSaleLot: saleLots.has(body.currentSaleLot) ? body.currentSaleLot : current.currentSaleLot || "relampago",
      ticketSalesClosed: Boolean(body.ticketSalesClosed),
      registrationOpen: Boolean(body.registrationOpen),
      updatedAt: now()
    };
    await db.save("settings", settings);
    return send(res, 200, { settings });
  }

  if (pathname === "/api/admin/users" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const users = await adminUsersWithTicketCounts();
    return send(res, 200, { users });
  }

  if (pathname === "/api/admin/users/export" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const workbook = createUsersWorkbook(await adminUsersWithTicketCounts());
    const buffer = await workbook.xlsx.writeBuffer();
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="usuarios-ingressos.xlsx"',
      "Content-Length": buffer.length,
      "Cache-Control": "no-store"
    });
    return res.end(Buffer.from(buffer));
  }

  if (pathname === "/api/admin/sales-report/export" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const workbook = createSalesReportWorkbook(await db.all("tickets"));
    const buffer = await workbook.xlsx.writeBuffer();
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="relatorio-vendas-ingressos.xlsx"',
      "Content-Length": buffer.length,
      "Cache-Control": "no-store"
    });
    return res.end(Buffer.from(buffer));
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch && req.method === "PUT") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const allowed = ["usuarios", "participant", "checkin", "admin"];
    if (!allowed.includes(body.role)) return send(res, 400, { message: "Perfil inválido." });
    const users = await db.all("users");
    const user = users.find((item) => item.id === roleMatch[1]);
    if (!user) return send(res, 404, { message: "Usuário não encontrado." });
    user.role = body.role;
    user.updatedAt = now();
    await db.save("users", user);
    return send(res, 200, { user: publicUser(user) });
  }

  const confirmMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)\/confirm$/);
  if (confirmMatch && req.method === "POST") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const tickets = await db.all("tickets");
    const ticket = tickets.find((item) => item.id === confirmMatch[1]);
    if (!ticket) return send(res, 404, { message: "Ingresso não encontrado." });
    ticket.status = "confirmed";
    ticket.mercadoPagoStatus = "manual";
    ticket.confirmedAt = now();
    ticket.paidAt = ticket.confirmedAt;
    ticket.manualConfirmedBy = auth.user.id;
    ticket.manualConfirmedByName = auth.user.name;
    ticket.updatedAt = now();
    await db.save("tickets", ticket);
    await trySendPurchasedTicketsEmail([ticket]);
    return send(res, 200, { ticket: await ticketWithQr(ticket) });
  }

  return send(res, 404, { message: "Rota não encontrada." });
}

function extractMercadoPagoPaymentId(body, url) {
  const resource = String(body?.resource || url.searchParams.get("resource") || "");
  const resourceMatch = resource.match(/\/payments\/(\d+)(?:\?.*)?$/);
  const candidates = [
    body?.data?.id,
    body?.payment_id,
    body?.id,
    url.searchParams.get("data.id"),
    url.searchParams.get("payment_id"),
    url.searchParams.get("id"),
    resourceMatch?.[1]
  ];
  const paymentId = candidates.find((candidate) => /^\d+$/.test(String(candidate || "").trim()));
  return paymentId ? String(paymentId).trim() : "";
}

async function mercadoPagoWebhook(req, res, url) {
  if (req.method !== "POST") return send(res, 405, { ok: false, message: "Método não permitido." }, { Allow: "POST" });
  await ensureSeed();

  const body = await parseBody(req).catch((error) => {
    webhookLog("corpo inválido", { error: error.message });
    return {};
  });
  const paymentId = extractMercadoPagoPaymentId(body, url);
  webhookLog("recebido", {
    type: body?.type || url.searchParams.get("type") || url.searchParams.get("topic") || null,
    action: body?.action || null,
    paymentId: paymentId || null
  });

  if (!paymentId) {
    webhookLog("ignorado: payment_id ausente ou inválido");
    return send(res, 200, { ok: true, ignored: true });
  }
  if (!MP_TOKEN) {
    console.error("[Mercado Pago webhook] MERCADO_PAGO_ACCESS_TOKEN não configurado.");
    return send(res, 503, { ok: false, message: "Integração de pagamentos indisponível." });
  }

  try {
    webhookLog("consultando pagamento", { paymentId });
    const result = await synchronizeMercadoPagoPayment(paymentId, {
      origin: "webhook",
      sendEmail: false,
      apiRetries: 0
    });
    webhookLog("pagamento consultado", {
      paymentId,
      status: result.paymentStatus,
      knownStatus: mercadoPagoKnownStatuses.has(result.paymentStatus),
      externalReference: result.reference || null,
      ticketsUpdated: result.updatedCount,
      newlyApproved: result.newlyApprovedCount
    });
    send(res, 200, { ok: true });
    if (result.paymentStatus === "approved" && result.relatedTickets.length) {
      setImmediate(() => {
        sendMercadoPagoTicketsEmail(paymentId, result.relatedTickets.map((ticket) => ticket.id), "webhook")
          .catch((error) => console.error("[Mercado Pago] Falha inesperada na fila de e-mail:", {
            origin: "webhook",
            paymentId,
            error: error.message
          }));
      });
    }
    return undefined;
  } catch (error) {
    console.error("[Mercado Pago webhook] Falha ao processar notificação:", {
      paymentId,
      error: error.message,
      mercadoPagoStatusCode: error.statusCode || null
    });
    return send(res, 502, { ok: false, message: "Não foi possível consultar o pagamento." });
  }
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(STATIC_DIR, "index.html") : path.join(STATIC_DIR, pathname);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    return res.end("Acesso negado");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<h1>EJD - credenciamento</h1><p>Execute npm run build para gerar o frontend.</p>");
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, APP_URL);
    if (url.pathname === "/health") {
      if (mysqlPool) await ensureMysqlReady();
      return send(res, 200, { ok: true, storage: mysqlPool ? "mysql" : neonSql ? "neon" : supabase ? "supabase" : "local" });
    }
    if (url.pathname.startsWith("/api/")) return api(req, res, url.pathname);
    if (url.pathname === "/webhook/mercadopago") return mercadoPagoWebhook(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return send(res, 500, { message: error.message || "Erro interno." });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    ensureLocalFiles();
    console.log(`EJD - credenciamento em http://localhost:${PORT}`);
    console.log(`Webhook Mercado Pago: ${APP_URL}/webhook/mercadopago`);
    if (MP_TOKEN && (!APP_URL.startsWith("https://") || /localhost|127\.0\.0\.1/.test(APP_URL))) {
      console.warn("Mercado Pago configurado, mas APP_URL não parece ser uma URL HTTPS pública de produção.");
    }
  });
}

module.exports = server;
if (process.env.NODE_ENV === "test") {
  module.exports.testHelpers = {
    applyMercadoPagoPayment,
    createSalesReportWorkbook,
    createUsersWorkbook,
    createMercadoPagoCardPayment,
    extractMercadoPagoPaymentId,
    mercadoPagoWebhook,
    mercadoPagoRequest,
    db,
    isExpiredPendingTicket,
    isMercadoPagoWaiting,
    isTicketPaid
  };
}
