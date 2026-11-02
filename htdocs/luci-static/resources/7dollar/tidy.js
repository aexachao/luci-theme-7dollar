'use strict';
'require baseclass';
'require uci';
'require 7dollar.common as td';

/*
 * Plain status by default. Native LuCI status blocks (interfaces, Wi-Fi, overview) list every
 * field they know; this marks the engineering ones (MAC, BSSID, packet counts, MCS, noise, ...)
 * as .td-x and gives their section a "Details" button. Nothing is removed: one click shows all.
 * Labels are matched through LuCI's own translations, so it works in every language.
 * Runs in the browser only, after each re-render of #view; the router does no extra work.
 */

const T = td.T, icon = td.icon;
const BAND = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', '60g': '60 GHz' };
let W;

function words(list) { return new Set(list.map(s => _(s))); }

function dict() {
	return W ??= {
		item: words([ 'MAC', 'MAC address', 'BSSID', 'Mode', 'RX', 'TX', 'Gateway', 'DNS', 'Expires', 'Device', 'Type',
		              'Tx-Power', 'Noise', 'Country', 'Prefix Delegated' ]),
		v6: words([ 'IPv6', 'IPv6-PD' ]),          // hidden only when the same list already has an IPv4 address
		v4: words([ 'IPv4', 'Address' ]),
		row: words([ 'Architecture', 'Target Platform', 'Kernel Version', 'Load Average', 'Buffered', 'Cached' ]),
		col: words([ 'MAC address', 'DUID' ]),
		host: words([ 'Host', 'Hostname' ]),
		fw: _('Firmware Version'),
		noise: new RegExp(`\\s*/\\s*${_('Noise')}\\s*$`)   // the "Signal / Noise" header
	};
}

/* Wrap the part of a direct text child that matches re (or its first group) in .td-x. */
function fold(el, re) {
	for (const n of el.childNodes) {
		const m = n.nodeType == 3 && re.exec(n.data);
		if (!m) continue;
		const part = m[1] ?? m[0];
		const mid = n.splitText(m.index + m[0].indexOf(part));
		mid.splitText(part.length);
		const s = E('span', { class: 'td-x' });
		mid.replaceWith(s);
		s.append(mid);
		return s;
	}
}

function hide(el) {
	el.classList.add('td-x');
	return el;
}

const shown = n => n.nodeType == 1 && n.matches('span.nowrap') && !n.classList.contains('td-x');

/* L.itemlist() output: <span.nowrap><strong>Label: </strong>value</span>, separated by " | " or <br>. */
function list(box, w) {
	const nodes = [ ...box.childNodes ];
	const items = nodes.filter(n => n.nodeType == 1 && n.matches('span.nowrap'));
	const label = e => e.firstChild?.nodeName == 'STRONG' ? e.firstChild.textContent.replace(/:\s*$/, '') : '';
	const has4 = items.some(e => w.v4.has(label(e)));

	items.forEach(e => {
		const l = label(e);
		if (w.item.has(l) || (has4 && w.v6.has(l))) hide(e);
		else if (l) fold(e, /\s+\([^()]*\)\s*$/);   // "149 (5.745 GHz)", "WPA2 PSK (CCMP)"
	});

	/* A separator goes with the item before it, and also when nothing visible follows. */
	let prev = null;
	nodes.forEach((n, i) => {
		if (items.includes(n)) return void (prev = n);
		if (!prev || (shown(prev) && nodes.slice(i + 1).some(shown))) return;
		if (n.nodeType == 3) { const s = E('span', { class: 'td-x' }); n.replaceWith(s); s.append(n); }
		else if (n.nodeType == 1) hide(n);
	});

	const badge = box.closest('.ifacebadge');
	if (badge && items.length && !items.some(shown)) hide(badge);
}

function scan(view) {
	const w = dict(), out = [];
	const mark = el => el && out.push(el);

	new Set([ ...view.querySelectorAll('span.nowrap') ].map(e => e.parentNode)).forEach(box => box.closest('.cbi-tooltip') || list(box, w));
	view.querySelectorAll('span.nowrap.td-x, .ifacebadge.td-x').forEach(mark);

	/* two-column status tables (overview): fold whole rows */
	view.querySelectorAll('.tr').forEach(tr => {
		const c = tr.children;
		if (c.length != 2) return;
		const k = c[0].textContent.trim();
		if (w.row.has(k)) mark(hide(tr));
		else if (k == w.fw) mark(fold(c[1], /^\S+\s+\S+(\s.+)$/s));   // keep "OpenWrt 24.10.5"
	});

	/* device tables (clients, leases): MAC / DUID columns, host suffixes and addresses, Wi-Fi rate details, noise.
	 * Tables without a host column (neighbours, device config) are about those addresses, so they stay. */
	const named = new Set([ ...view.querySelectorAll('.th') ].filter(th => w.host.has(th.textContent.trim())).map(th => th.closest('.table')));
	view.querySelectorAll('.th').forEach(th => named.has(th.closest('.table')) && w.col.has(th.textContent.trim()) ? mark(hide(th)) : mark(fold(th, w.noise)));
	view.querySelectorAll('.td[data-title]').forEach(c => {
		const t = c.getAttribute('data-title');
		if (w.col.has(t)) return named.has(c.closest('.table')) && mark(hide(c));
		if (w.noise.test(t)) c.setAttribute('data-title', t.replace(w.noise, ''));   // label of the phone layout
		if (!w.host.has(t)) return;
		c.querySelectorAll('.hide-xs').forEach(e => mark(hide(e)));
		mark(fold(c, /\s+\([^()]*\)\s*$/));
		mark(fold(c, /^[^\s.:]*[a-z][^\s.:]*(\.[a-z][\w.-]*)/i));   // "Pixel.lan" -> "Pixel"; IPs stay
	});
	view.querySelectorAll('.assoclist .td > span:not(.ifacebadge) > span').forEach(s => mark(fold(s, /,\s.*$/s)));
	view.querySelectorAll('[data-noise] > span').forEach(s => mark(fold(s, /\/-?\d+/)));
	view.querySelectorAll('.assoclist .ifacebadge[data-ssid]').forEach(mark);

	/* an empty secondary device table (e.g. no DHCPv6 leases) folds away with its title */
	view.querySelectorAll('.table .placeholder').forEach(p => {
		const t = p.closest('.table'), h = t.previousElementSibling;
		if (named.has(t) && h?.matches('h3') && h != head(t)[1]) { mark(hide(t)); hide(h); }
	});

	/* radio rows on the Wi-Fi page: "5 GHz" instead of the chipset name */
	view.querySelectorAll('[data-sid] [data-name=_stat] big > strong').forEach(s => {
		if (s.querySelector('.td-y')) return;
		const b = BAND[uci.get('wireless', s.closest('[data-sid]').getAttribute('data-sid'), 'band')];
		if (!b) return;
		s.replaceChildren(E('span', { class: 'td-x' }, s.textContent), E('span', { class: 'td-y' }, b));
		mark(s);
	});

	out.forEach(arm);
}

/* The section an element belongs to, and the heading that carries its Details button. */
function head(el) {
	let sec = el.closest('.cbi-section');
	if (sec)
		return [ sec, sec.querySelector(':scope > h3') ?? sec.querySelector('h3') ];
	sec = el.closest('table');
	return [ sec, sec?.previousElementSibling?.matches('h3') ? sec.previousElementSibling : null ];
}

function arm(el) {
	const [ sec, h ] = head(el);
	if (!h) return;

	sec.classList.add('td-sec');
	if (h.querySelector('.td-detail')) return;

	const btn = E('button', { type: 'button', class: 'td-detail' });
	const paint = open => {
		btn.setAttribute('aria-expanded', open);
		btn.innerHTML = `${T(open ? '收起' : '详情', open ? 'Less' : 'Details')}${icon('chev')}`;
	};
	btn.addEventListener('click', () => paint(sec.classList.toggle('td-open')));
	paint(sec.classList.contains('td-open'));
	h.classList.add('td-sec-h');
	h.append(btn);
}

return baseclass.extend({
	__init__() {
		const view = document.getElementById('view');
		if (!view) return;
		let queued = false;
		const run = () => { queued = false; scan(view); };
		new MutationObserver(() => queued || (queued = true, requestAnimationFrame(run)))
			.observe(view, { childList: true, subtree: true });
		run();
	}
});
