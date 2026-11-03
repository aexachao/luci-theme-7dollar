'use strict';
'require view';
'require poll';
'require 7dollar.common as td';

/* All devices: online (Wi-Fi + wired) and recently seen DHCP clients. The summary tiles filter the list. */

const T = td.T, icon = td.icon, esc = td.esc;

return view.extend({
	load() {
		if (!td.active) {
			location.replace(L.url('admin/status/overview'));
			return new Promise(() => {});
		}
		return td.clients();
	},

	render(list) {
		const root = td.html(`<div class="td-devices">
			<div class="td-head"><div>
				<p class="td-eyebrow">${esc(T('设备', 'Devices'))}</p>
				<h1 class="td-serif">${esc(T('谁在用网络', 'Who is online'))}</h1>
				<p class="td-sub" id="td-dsum">&nbsp;</p>
			</div>
			<a class="btn" href="${L.url('admin/network/dhcp')}">${icon('lock')}${esc(T('给设备固定 IP', 'Reserve an IP'))}</a></div>
			<div class="td-stats" id="td-dstats" role="group" aria-label="${esc(T('按连接状态筛选', 'Filter devices'))}">
				<button type="button" class="td-stat on" data-filter="online" aria-controls="td-dev-list" aria-pressed="true"><small>${esc(T('在线', 'Online'))}</small><b>0</b></button>
				<button type="button" class="td-stat" data-filter="wifi" aria-controls="td-dev-list" aria-pressed="false"><small>Wi‑Fi</small><b>0</b></button>
				<button type="button" class="td-stat" data-filter="wired" aria-controls="td-dev-list" aria-pressed="false"><small>${esc(T('有线', 'Wired'))}</small><b>0</b></button>
				<button type="button" class="td-stat" data-filter="recent" aria-controls="td-dev-list" aria-pressed="false"><small>${esc(T('最近连接过', 'Recently seen'))}</small><b>0</b></button>
			</div>
			<section class="td-card">
				<div class="td-dev-note td-muted" id="td-dev-note" hidden></div>
				<div class="td-devlist" id="td-dev-list"></div>
			</section>
		</div>`);

		this.root = root;
		this.filter = 'online';
		root.querySelector('#td-dstats').addEventListener('click', ev => {
			const btn = ev.target.closest('[data-filter]');
			if (!btn) return;
			this.filter = btn.dataset.filter;
			this.paint(this.list);
		});
		this.paint(list);
		poll.add(() => td.clients().then(l => this.paint(l)), 5);
		return root;
	},

	row(c) {
		const meta = [];
		if (c.ip) meta.push(`<span>${esc(c.ip)}</span>`);
		meta.push(`<span>${esc(c.mac)}</span>`);

		let sub;
		if (!c.online) sub = c.expires > 0 ? T('租约剩余 ', 'Lease ') + td.duration(c.expires) : T('离线', 'Offline');
		else if (c.conn == 'wifi') {
			const [ s ] = td.signal(c.signal);
			sub = `Wi‑Fi ${td.bandName(c.band)} · ${s}${c.signal ? ` (${c.signal} dBm)` : ''}`;
			if (c.link) meta.unshift(`<span><b>${Math.round(c.link)} Mbps</b></span>`);
			if (c.since) meta.push(`<span>${esc(T('已连接 ', 'Connected ') + td.duration(c.since))}</span>`);
		}
		else sub = td.connName(c);

		return `<div class="td-dev"><div class="td-av">${icon(c.kind)}</div><div class="nm"><b>${esc(c.display)}</b><small>${esc(sub)}</small></div><div class="meta">${meta.join('')}</div></div>`;
	},

	paint(list) {
		this.list = list;
		const on = list.filter(c => c.online), off = list.filter(c => !c.online);
		const wifi = on.filter(c => c.conn == 'wifi');
		const wired = on.filter(c => c.conn != 'wifi');
		/* a side router sees the whole LAN on its port, so that tile is 局域网, not 有线 */
		const lan = list.some(c => c.conn == 'lan');
		const $ = id => this.root.querySelector('#' + id);

		$('td-dsum').textContent = on.length
			? T(`现在有 ${on.length} 台设备在线。名字来自设备自己上报的主机名。`, `${on.length} device${on.length == 1 ? '' : 's'} online right now.`)
			: T('现在没有设备在线。', 'No devices online right now.');

		const counts = { online: on.length, wifi: wifi.length, wired: wired.length, recent: off.length };
		Object.entries(counts).forEach(([ key, count ]) => {
			const btn = $('td-dstats').querySelector(`[data-filter="${key}"]`);
			if (key == 'wired') btn.querySelector('small').textContent = lan ? T('局域网', 'LAN') : T('有线', 'Wired');
			btn.querySelector('b').textContent = count;
			btn.classList.toggle('on', this.filter == key);
			btn.setAttribute('aria-pressed', String(this.filter == key));
		});

		const recent = this.filter == 'recent';
		const rows = this.filter == 'wifi' ? wifi
			: this.filter == 'wired' ? wired
			: recent ? off : on;
		const empty = this.filter == 'wifi' ? T('现在没有 Wi‑Fi 设备在线', 'No Wi‑Fi devices online')
			: this.filter == 'wired' ? T('现在没有有线设备在线', 'No wired devices online')
			: recent ? T('没有离线设备', 'No offline devices')
			: T('现在没有设备在线', 'No devices online');

		$('td-dev-note').hidden = !(recent && off.length);
		$('td-dev-note').textContent = recent && off.length ? T('有 IP 租约，当前离线', 'Leased, currently offline') : '';
		$('td-dev-list').innerHTML = rows.length ? rows.map(c => this.row(c)).join('') : `<div class="td-empty-row">${esc(empty)}</div>`;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
