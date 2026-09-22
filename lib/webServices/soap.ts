/*
 * SOAP — Business Central's /WS endpoint over the published web services:
 *
 *   GET  /WS/Page/Members?wsdl                       WSDL of a page service
 *   POST /WS/Page/Members                            Read, ReadMultiple, Create, Update, Delete, IsUpdated
 *   GET  /WS/Codeunit/SaccoIntegration?wsdl          WSDL of a codeunit service
 *   POST /WS/Codeunit/SaccoIntegration               one operation per procedure
 *   GET  /WS/SystemService?wsdl · POST Companies     BC's SystemService
 *
 * A company segment is accepted (/WS/<Company>/Page/Members) and ignored — one company here.
 * Namespaces follow BC: urn:microsoft-dynamics-schemas/page/<name> and /codeunit/<name>.
 * ReadMultiple takes BC filter criteria: `..` ranges, `|` alternatives, `<>`, `>=`, `*` wildcards.
 */
import {
  resolveService, assertReadable, assertWritable, assertProcedure, readRows, readOne, createRow, modifyRow, deleteRow, coerceArgs, etagOf,
  fieldSql, toSqlValue, WsError, statusOfError, assertKeyAllows, type Condition,
} from './index.ts';

/** Codeunit procedures named like a lookup are reads for a read-only key; anything else writes. */
const READ_LIKE = /^(Get|Read|List|Find|Is|Has|Check|Calculate|Preview)/i;
import { keyField, type WsField, type WsPage, type WsQuery, type WsCodeunit, type WsType, type WsContext } from './objects.ts';
import type { SessionUser } from '../types.ts';

/* ------------------------------------------------------------------------------ XML */

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
const local = (qname: string) => qname.includes(':') ? qname.slice(qname.indexOf(':') + 1) : qname;

/** A small, strict-enough XML reader for SOAP envelopes: elements, attributes, text, CDATA,
 *  comments and the prolog. Namespace prefixes are dropped from element names. */
export function parseXml(src: string): XmlNode {
  let i = 0; const s = src;
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += decodeEntities(s.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(s.slice(i, lt));
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); if (e < 0) throw new WsError(400, 'BadRequest', 'Malformed XML prolog'); i = e + 2; continue; }
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); if (e < 0) throw new WsError(400, 'BadRequest', 'Unterminated comment'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); if (e < 0) throw new WsError(400, 'BadRequest', 'Unterminated CDATA'); stack[stack.length - 1].text += s.slice(lt + 9, e); i = e + 3; continue; }
    if (s.startsWith('<!', lt)) { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; continue; }
    if (s.startsWith('</', lt)) {
      const e = s.indexOf('>', lt); if (e < 0) throw new WsError(400, 'BadRequest', 'Malformed closing tag');
      const name = local(s.slice(lt + 2, e).trim());
      const top = stack.pop();
      if (!top || top.name !== name) throw new WsError(400, 'BadRequest', `Mismatched closing tag </${name}>`);
      i = e + 1; continue;
    }
    // Opening tag — find its end, honouring quotes inside attribute values.
    let j = lt + 1; let quote = '';
    while (j < s.length) { const ch = s[j]; if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; j++; }
    if (j >= s.length) throw new WsError(400, 'BadRequest', 'Malformed tag');
    let tag = s.slice(lt + 1, j); const selfClosing = tag.endsWith('/'); if (selfClosing) tag = tag.slice(0, -1);
    const nameMatch = tag.match(/^\s*([^\s/>]+)/); if (!nameMatch) throw new WsError(400, 'BadRequest', 'Malformed tag');
    const node: XmlNode = { name: local(nameMatch[1]), attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let am: RegExpExecArray | null;
    const rest = tag.slice(nameMatch[0].length);
    while ((am = attrRe.exec(rest))) node.attrs[am[1]] = decodeEntities(am[2] ?? am[3] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  if (stack.length !== 1) throw new WsError(400, 'BadRequest', `Unclosed element <${stack[stack.length - 1].name}>`);
  return root;
}

const child = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
const childText = (n: XmlNode | undefined, name: string): string | undefined => { const c = child(n, name); return c ? c.text.trim() : undefined; };
/** Escaping for attribute values (quotes included). */
const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escaping for text nodes — quotes are legal there, and a value full of &quot; reads badly in a client. */
const text = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A CDATA section; the one sequence CDATA cannot hold is split across two sections. */
const cdata = (s: string): string => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

/** A JSON key as an XML element name: letters, digits, underscores, dots and dashes only, never starting with a digit. */
const elementName = (key: string): string => {
  const clean = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(clean) ? clean : `_${clean}`;
};
/** The element name for an array's items: "transactions" → "transaction", otherwise "item". */
const itemName = (key: string): string => (/[a-z]s$/.test(key) && key.length > 3 ? key.slice(0, -1) : 'item');

/**
 * A codeunit's JSON result as XML elements — an object's keys become child elements, an array
 * repeats an element per entry, a primitive is a text node — so a SOAP client reads
 * <accountNo>SA0100009</accountNo> and <transactions><transaction>…</transaction></transactions>
 * rather than one escaped JSON string.
 */
function jsonToXml(value: unknown, name: string, indent: string): string {
  if (value === null || value === undefined) return `${indent}<${name}/>\n`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}<${name}/>\n`;
    const child = itemName(name);
    return `${indent}<${name}>\n${value.map((v) => jsonToXml(v, child, `${indent}  `)).join('')}${indent}</${name}>\n`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${indent}<${name}/>\n`;
    return `${indent}<${name}>\n${entries.map(([k, v]) => jsonToXml(v, elementName(k), `${indent}  `)).join('')}${indent}</${name}>\n`;
  }
  return `${indent}<${name}>${text(typeof value === 'boolean' ? (value ? 'true' : 'false') : value)}</${name}>\n`;
}

/* ------------------------------------------------------------------------------ WSDL */

const xsdType = (t: WsType | 'Json'): string => ({
  Code: 'string', Text: 'string', Integer: 'int', Decimal: 'decimal', Money: 'decimal', Boolean: 'boolean', Date: 'date', DateTime: 'dateTime', Json: 'string',
} as Record<string, string>)[t];

export const pageNamespace = (service: string) => `urn:school-erp-schemas/page/${service.toLowerCase()}`;
export const codeunitNamespace = (service: string) => `urn:school-erp-schemas/codeunit/${service}`;

const PAGE_OPS = ['Read', 'ReadMultiple', 'Create', 'Update', 'Delete', 'IsUpdated'] as const;

export function pageWsdl(serviceName: string, o: WsPage | WsQuery, endpoint: string): string {
  const ns = pageNamespace(serviceName); const key = keyField(o);
  const el = (name: string, type: string, minOccurs = '0') => `<element minOccurs="${minOccurs}" maxOccurs="1" name="${xml(name)}" type="${type}"/>`;
  const writable = o.kind === 'PAGE';
  return `<?xml version="1.0" encoding="utf-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="${ns}" targetNamespace="${ns}">
  <types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified" targetNamespace="${ns}">
      <complexType name="${xml(serviceName)}">
        <sequence>
          ${el('Key', 'string')}
          ${o.fields.map((f) => el(f.name, `${xsdType(f.type)}`)).join('\n          ')}
        </sequence>
      </complexType>
      <complexType name="${xml(serviceName)}_List"><sequence><element minOccurs="0" maxOccurs="unbounded" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType>
      <complexType name="${xml(serviceName)}_Filter"><sequence><element minOccurs="1" maxOccurs="1" name="Field" type="tns:${xml(serviceName)}_Fields"/><element minOccurs="1" maxOccurs="1" name="Criteria" type="string"/></sequence></complexType>
      <simpleType name="${xml(serviceName)}_Fields"><restriction base="string">${o.fields.map((f) => `<enumeration value="${xml(f.name)}"/>`).join('')}</restriction></simpleType>
      <element name="Read"><complexType><sequence>${el(key.name, xsdType(key.type), '1')}</sequence></complexType></element>
      <element name="Read_Result"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType></element>
      <element name="ReadMultiple"><complexType><sequence><element minOccurs="0" maxOccurs="unbounded" name="filter" type="tns:${xml(serviceName)}_Filter"/>${el('bookmarkKey', 'string')}${el('setSize', 'int', '1')}</sequence></complexType></element>
      <element name="ReadMultiple_Result"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="ReadMultiple_Result" type="tns:${xml(serviceName)}_List"/></sequence></complexType></element>
      <element name="IsUpdated"><complexType><sequence>${el('Key', 'string', '1')}</sequence></complexType></element>
      <element name="IsUpdated_Result"><complexType><sequence>${el('IsUpdated_Result', 'boolean', '1')}</sequence></complexType></element>
      ${writable ? `<element name="Create"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType></element>
      <element name="Create_Result"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType></element>
      <element name="Update"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType></element>
      <element name="Update_Result"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="${xml(serviceName)}" type="tns:${xml(serviceName)}"/></sequence></complexType></element>
      <element name="Delete"><complexType><sequence>${el('Key', 'string', '1')}</sequence></complexType></element>
      <element name="Delete_Result"><complexType><sequence>${el('Delete_Result', 'boolean', '1')}</sequence></complexType></element>` : ''}
    </schema>
  </types>
  ${(writable ? PAGE_OPS : ['Read', 'ReadMultiple', 'IsUpdated']).map((op) => `<message name="${op}"><part name="parameters" element="tns:${op}"/></message>
  <message name="${op}_Result"><part name="parameters" element="tns:${op}_Result"/></message>`).join('\n  ')}
  <portType name="${xml(serviceName)}_Port">
    ${(writable ? PAGE_OPS : ['Read', 'ReadMultiple', 'IsUpdated']).map((op) => `<operation name="${op}"><input message="tns:${op}"/><output message="tns:${op}_Result"/></operation>`).join('\n    ')}
  </portType>
  <binding name="${xml(serviceName)}_Binding" type="tns:${xml(serviceName)}_Port">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    ${(writable ? PAGE_OPS : ['Read', 'ReadMultiple', 'IsUpdated']).map((op) => `<operation name="${op}"><soap:operation soapAction="${ns}:${op}" style="document"/><input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>`).join('\n    ')}
  </binding>
  <service name="${xml(serviceName)}_Service">
    <port name="${xml(serviceName)}_Port" binding="tns:${xml(serviceName)}_Binding"><soap:address location="${xml(endpoint)}"/></port>
  </service>
</definitions>`;
}

export function codeunitWsdl(serviceName: string, cu: WsCodeunit, endpoint: string): string {
  const ns = codeunitNamespace(serviceName);
  return `<?xml version="1.0" encoding="utf-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="${ns}" targetNamespace="${ns}">
  <types>
    <schema xmlns="http://www.w3.org/2001/XMLSchema" elementFormDefault="qualified" targetNamespace="${ns}">
      ${cu.procedures.map((p) => `<element name="${p.name}"><complexType><sequence>${p.params.map((prm) => `<element minOccurs="${prm.required ? 1 : 0}" maxOccurs="1" name="${xml(prm.name)}" type="${xsdType(prm.type)}"/>`).join('')}</sequence></complexType></element>
      <element name="${p.name}_Result"><complexType><sequence><element minOccurs="1" maxOccurs="1" name="return_value" type="${xsdType(p.returns)}"/></sequence></complexType></element>`).join('\n      ')}
    </schema>
  </types>
  ${cu.procedures.map((p) => `<message name="${p.name}"><part name="parameters" element="tns:${p.name}"/></message>
  <message name="${p.name}_Result"><part name="parameters" element="tns:${p.name}_Result"/></message>`).join('\n  ')}
  <portType name="${xml(serviceName)}_Port">
    ${cu.procedures.map((p) => `<operation name="${p.name}"><input message="tns:${p.name}"/><output message="tns:${p.name}_Result"/></operation>`).join('\n    ')}
  </portType>
  <binding name="${xml(serviceName)}_Binding" type="tns:${xml(serviceName)}_Port">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    ${cu.procedures.map((p) => `<operation name="${p.name}"><soap:operation soapAction="${ns}:${p.name}" style="document"/><input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>`).join('\n    ')}
  </binding>
  <service name="${xml(serviceName)}_Service">
    <port name="${xml(serviceName)}_Port" binding="tns:${xml(serviceName)}_Binding"><soap:address location="${xml(endpoint)}"/></port>
  </service>
</definitions>`;
}

/* ------------------------------------------------------------------------------ BC filter criteria */

/**
 * BC's ReadMultiple filter syntax on one field: `1000`, `1000..2000`, `..2000`, `1000..`,
 * `<>X`, `>=X`, `<X`, `A|B|C`, `*ABC*` (wildcard), `@abc` (case-insensitive), `''` (blank).
 */
export function criteriaToCondition(f: WsField, criteria: string): Condition {
  const col = fieldSql(f);
  const alternatives = criteria.split('|').map((a) => a.trim()).filter((a) => a.length || criteria === '');
  const parts: Condition[] = [];
  for (let alt of alternatives.length ? alternatives : ['']) {
    let ci = false;
    if (alt.startsWith('@')) { ci = true; alt = alt.slice(1); }
    if (alt === "''" || alt === '') { parts.push({ sql: `(${col} IS NULL OR CAST(${col} AS TEXT) = '')`, args: [] }); continue; }
    const range = alt.match(/^(.*?)\.\.(.*)$/);
    if (range) {
      const [, lo, hi] = range; const conds: string[] = []; const args: unknown[] = [];
      if (lo.trim()) { conds.push(`${col} >= ?`); args.push(toSqlValue(f, lo.trim())); }
      if (hi.trim()) { conds.push(`${col} <= ?`); args.push(toSqlValue(f, hi.trim())); }
      parts.push({ sql: conds.join(' AND ') || '1=1', args }); continue;
    }
    const cmp = alt.match(/^(<>|>=|<=|>|<|=)\s*(.*)$/);
    if (cmp) { parts.push({ sql: `${col} ${cmp[1]} ?`, args: [toSqlValue(f, cmp[2].trim())] }); continue; }
    if (alt.includes('*') || alt.includes('?')) {
      const pat = alt.replace(/[%_\\]/g, (m) => `\\${m}`).replace(/\*/g, '%').replace(/\?/g, '_');
      parts.push({ sql: `CAST(${col} AS TEXT) ${ci ? 'ILIKE' : 'LIKE'} ? ESCAPE '\\'`, args: [pat] }); continue;
    }
    parts.push(ci ? { sql: `LOWER(CAST(${col} AS TEXT)) = LOWER(?)`, args: [alt] } : { sql: `${col} = ?`, args: [toSqlValue(f, alt)] });
  }
  return { sql: parts.map((p) => `(${p.sql})`).join(' OR '), args: parts.flatMap((p) => p.args) };
}

/* ------------------------------------------------------------------------------ envelopes */

export interface SoapResult { status: number; xml: string; serviceName?: string | null; operation?: string | null }

const envelope = (bodyXml: string) => `<?xml version="1.0" encoding="utf-8"?>
<Soap:Envelope xmlns:Soap="http://schemas.xmlsoap.org/soap/envelope/">
  <Soap:Body>
${bodyXml}
  </Soap:Body>
</Soap:Envelope>`;

export function soapFault(status: number, code: string, message: string, detail?: string): SoapResult {
  return {
    status,
    xml: envelope(`    <Soap:Fault>
      <faultcode>${status >= 500 ? 'Soap:Server' : 'Soap:Client'}</faultcode>
      <faultstring>${text(message)}</faultstring>
      <detail><string xmlns="urn:school-erp-schemas/error">${text(detail ?? code)}</string></detail>
    </Soap:Fault>`),
  };
}

function recordXml(serviceName: string, o: WsPage | WsQuery, row: Record<string, unknown>): string {
  const key = String(row[keyField(o).name] ?? '');
  const fields = o.fields.map((f) => {
    const v = row[f.name]; if (v == null) return '';
    return `      <${f.name}>${text(f.type === 'Boolean' ? (v ? 'true' : 'false') : v)}</${f.name}>`;
  }).filter(Boolean).join('\n');
  return `    <${serviceName} xmlns="${pageNamespace(serviceName)}">\n      <Key>${text(soapKey(key, row))}</Key>\n${fields}\n    </${serviceName}>`;
}

/** BC's opaque record Key: here the primary key plus the ETag, so Update/Delete can check it. */
const soapKey = (key: string, row: Record<string, unknown>) => `${key};${etagOf(row)}`;
const parseSoapKey = (k: string): { key: string; etag: string | null } => {
  const idx = k.indexOf(';');
  return idx < 0 ? { key: k, etag: null } : { key: k.slice(0, idx), etag: k.slice(idx + 1) };
};

function recordFromXml(o: WsPage, node: XmlNode | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of node?.children ?? []) {
    if (c.name === 'Key') continue;
    const f = o.fields.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    if (!f) throw new WsError(400, 'BadRequest', `Unknown field ${c.name}`);
    out[f.name] = f.type === 'Boolean' ? c.text.trim().toLowerCase() === 'true' : c.text.trim();
  }
  return out;
}

/* ------------------------------------------------------------------------------ dispatch */

export async function handleSoap(request: Request, segments: string[], user: SessionUser | null, endpointBase: string): Promise<SoapResult> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  let segs = segments.filter(Boolean).map((s) => decodeURIComponent(s));
  // /WS/<Company>/Page/X — the company segment is anything before Page|Codeunit|SystemService.
  const kindIdx = segs.findIndex((s) => /^(page|codeunit|systemservice)$/i.test(s));
  if (kindIdx > 0) segs = segs.slice(kindIdx);
  const kind = (segs[0] ?? '').toLowerCase();
  const wantsWsdl = method === 'GET' && (url.searchParams.has('wsdl') || url.searchParams.has('WSDL'));

  if (kind === 'systemservice') {
    const cu = { kind: 'CODEUNIT', id: 0, name: 'SystemService', caption: 'System Service', procedures: [{ name: 'Companies', caption: '', params: [], returns: 'Json', run: async () => ['Company'] }] } as WsCodeunit;
    const sys = await resolveService('SystemService');
    const procs = sys && sys.object.kind === 'CODEUNIT' ? sys.object : cu;
    if (wantsWsdl) return { status: 200, xml: codeunitWsdl('SystemService', procs, `${endpointBase}/SystemService`), serviceName: 'SystemService', operation: 'WSDL' };
    if (!user) return soapFault(401, 'Unauthorized', 'Authentication required');
    return callCodeunit(request, 'SystemService', procs, user);
  }
  if (kind !== 'page' && kind !== 'codeunit') return soapFault(404, 'NotFound', 'Use /WS/Page/<ServiceName>, /WS/Codeunit/<ServiceName> or /WS/SystemService');
  const serviceName = segs[1];
  if (!serviceName) return soapFault(404, 'NotFound', 'Service name missing');
  const resolved = await resolveService(serviceName);
  if (!resolved) return soapFault(404, 'NotFound', `Service '${serviceName}' is not published`);
  const { service, object } = resolved;
  const name = service.service_name;

  if (kind === 'codeunit') {
    if (object.kind !== 'CODEUNIT') return soapFault(400, 'BadRequest', `${name} is a ${object.kind.toLowerCase()} service — use /WS/Page/${name}`);
    if (wantsWsdl) return { status: 200, xml: codeunitWsdl(name, object, `${endpointBase}/Codeunit/${name}`), serviceName: name, operation: 'WSDL' };
    if (!user) return soapFault(401, 'Unauthorized', 'Authentication required');
    return callCodeunit(request, name, object, user);
  }

  if (object.kind === 'CODEUNIT') return soapFault(400, 'BadRequest', `${name} is a codeunit service — use /WS/Codeunit/${name}`);
  const o = object as WsPage | WsQuery;
  if (wantsWsdl) return { status: 200, xml: pageWsdl(name, o, `${endpointBase}/Page/${name}`), serviceName: name, operation: 'WSDL' };
  if (method !== 'POST') return soapFault(405, 'MethodNotAllowed', 'POST a SOAP envelope, or GET ?wsdl');
  if (!user) return soapFault(401, 'Unauthorized', 'Authentication required');

  const ctx: WsContext = { user, actor: { id: user.id, username: user.username } };
  const body = child(child(parseXml(await request.text()), 'Envelope'), 'Body');
  const op = body?.children[0];
  if (!op) return soapFault(400, 'BadRequest', 'The SOAP body has no operation element');
  const ns = pageNamespace(name);
  assertKeyAllows(user, name, !/^(Read|ReadMultiple|IsUpdated)$/.test(op.name));
  const result = (inner: string) => ({ status: 200, xml: envelope(inner), serviceName: name, operation: op.name });

  switch (op.name) {
    case 'Read': {
      assertReadable(user, o);
      const k = keyField(o);
      const keyVal = childText(op, k.name) ?? childText(op, 'No') ?? childText(op, 'Key');
      if (keyVal == null) throw new WsError(400, 'BadRequest', `Read needs <${k.name}>`);
      const row = await readOne(o, keyVal);
      return result(`    <Read_Result xmlns="${ns}">\n${row ? recordXml(name, o, row) : ''}\n    </Read_Result>`);
    }
    case 'ReadMultiple': {
      assertReadable(user, o);
      const where: Condition[] = [];
      for (const fl of op.children.filter((c) => c.name === 'filter')) {
        const fieldName = childText(fl, 'Field') ?? ''; const criteria = childText(fl, 'Criteria') ?? '';
        const f = o.fields.find((x) => x.name.toLowerCase() === fieldName.toLowerCase());
        if (!f) throw new WsError(400, 'BadRequest', `Unknown filter field ${fieldName}`);
        if (criteria.trim() !== '') where.push(criteriaToCondition(f, criteria.trim()));
      }
      const setSize = Number(childText(op, 'setSize') ?? 0) || 0;
      const bookmark = childText(op, 'bookmarkKey');
      // The bookmark is the last record's key; paging continues after it.
      if (bookmark) { const k = keyField(o); where.push({ sql: `${fieldSql(k)} > ?`, args: [toSqlValue(k, parseSoapKey(bookmark).key)] }); }
      const { rows } = await readRows(o, { where, top: setSize > 0 ? Math.min(setSize, 5000) : 5000 });
      return result(`    <ReadMultiple_Result xmlns="${ns}">\n${rows.map((r) => recordXml(name, o, r)).join('\n')}\n    </ReadMultiple_Result>`);
    }
    case 'IsUpdated': {
      assertReadable(user, o);
      const { key, etag } = parseSoapKey(childText(op, 'Key') ?? '');
      const row = await readOne(o, key);
      const updated = !row || (etag != null && etagOf(row) !== etag);
      return result(`    <IsUpdated_Result xmlns="${ns}"><IsUpdated_Result>${updated}</IsUpdated_Result></IsUpdated_Result>`);
    }
    case 'Create': {
      if (o.kind !== 'PAGE') throw new WsError(405, 'MethodNotAllowed', 'Queries are read-only');
      assertWritable(user, o, 'insert');
      const row = await createRow(o, recordFromXml(o, child(op, name) ?? op.children[0]), ctx);
      return result(`    <Create_Result xmlns="${ns}">\n${recordXml(name, o, row)}\n    </Create_Result>`);
    }
    case 'Update': {
      if (o.kind !== 'PAGE') throw new WsError(405, 'MethodNotAllowed', 'Queries are read-only');
      assertWritable(user, o, 'modify');
      const rec = child(op, name) ?? op.children[0];
      const k = keyField(o);
      const { key, etag } = parseSoapKey(childText(rec, 'Key') ?? '');
      const keyVal = key || childText(rec, k.name);
      if (!keyVal) throw new WsError(400, 'BadRequest', `Update needs the record <Key> (from Read) or <${k.name}>`);
      if (etag) {
        const cur = await readOne(o, keyVal);
        if (cur && etagOf(cur) !== etag) throw new WsError(409, 'Conflict', 'Other user has modified the record — read it again and retry');
      }
      const values = recordFromXml(o, rec); delete values[k.name];
      const row = await modifyRow(o, keyVal, values, ctx);
      return result(`    <Update_Result xmlns="${ns}">\n${recordXml(name, o, row)}\n    </Update_Result>`);
    }
    case 'Delete': {
      if (o.kind !== 'PAGE') throw new WsError(405, 'MethodNotAllowed', 'Queries are read-only');
      assertWritable(user, o, 'delete');
      const { key } = parseSoapKey(childText(op, 'Key') ?? '');
      if (!key) throw new WsError(400, 'BadRequest', 'Delete needs <Key>');
      await deleteRow(o, key, ctx);
      return result(`    <Delete_Result xmlns="${ns}"><Delete_Result>true</Delete_Result></Delete_Result>`);
    }
    default:
      return soapFault(400, 'BadRequest', `Unknown operation ${op.name} — page services support ${PAGE_OPS.join(', ')}`);
  }
}

async function callCodeunit(request: Request, name: string, cu: WsCodeunit, user: SessionUser): Promise<SoapResult> {
  if (request.method.toUpperCase() !== 'POST') return soapFault(405, 'MethodNotAllowed', 'POST a SOAP envelope, or GET ?wsdl');
  const body = child(child(parseXml(await request.text()), 'Envelope'), 'Body');
  const op = body?.children[0];
  if (!op) return soapFault(400, 'BadRequest', 'The SOAP body has no operation element');
  const proc = cu.procedures.find((p) => p.name.toLowerCase() === op.name.toLowerCase());
  if (!proc) return soapFault(400, 'BadRequest', `Unknown procedure ${op.name} — ${name} exposes ${cu.procedures.map((p) => p.name).join(', ')}`);
  assertKeyAllows(user, name, !READ_LIKE.test(proc.name));
  assertProcedure(user, proc);
  const raw: Record<string, unknown> = {};
  for (const c of op.children) raw[c.name] = c.text.trim();
  const value = await proc.run(coerceArgs(proc, raw), { user, actor: { id: user.id, username: user.username } });
  // A JSON result goes out as the JSON document itself in a CDATA block — quotes and all, so a
  // channel client can take the text of <return_value> and parse it as JSON, with or without an
  // XML parser in between. ?result=xml on the endpoint URL renders it as elements instead
  // (jsonToXml), for a client that maps XML to objects.
  const wantsElements = new URL(request.url).searchParams.get('result') === 'xml';
  const resultXml = proc.returns === 'Json'
    ? (wantsElements ? jsonToXml(value ?? null, 'return_value', '      ') : `      <return_value>${cdata(JSON.stringify(value ?? null, null, 2))}</return_value>\n`)
    : `      <return_value>${text(proc.returns === 'Boolean' ? String(!!value) : String(value ?? ''))}</return_value>\n`;
  return {
    status: 200, serviceName: name, operation: proc.name,
    xml: envelope(`    <${proc.name}_Result xmlns="${codeunitNamespace(name)}">\n${resultXml}    </${proc.name}_Result>`),
  };
}

/** Any thrown error, as a SOAP fault with the matching HTTP status. */
export function faultFor(e: unknown): SoapResult {
  const { status, code, message } = statusOfError(e);
  return soapFault(status, code, message);
}
