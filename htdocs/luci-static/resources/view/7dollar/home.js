'use strict';
'require view';
'require fs';
'require poll';
'require request';
'require ui';
'require 7dollar.common as td';

/*
 * 7Dollar home dashboard. Only router data by default; plugin cards are opt-in.
 * Plugin cards read config/procd state once and never poll the plugin itself.
 */

const T = td.T, icon = td.icon, esc = td.esc;
const N = 60;
const RING = 2 * Math.PI * 24;
const PROTO = { dhcp: T('自动获取', 'DHCP'), pppoe: T('宽带拨号', 'PPPoE'), static: T('静态地址', 'Static'), dhcpv6: 'DHCPv6', qmi: T('移动网络', 'Cellular'), ncm: T('移动网络', 'Cellular'), modemmanager: T('移动网络', 'Cellular') };

return view.extend({
	load() {
		if (!td.active) {
			location.replace(L.url('admin/status/overview'));
			return new Promise(() => {});
		}

		return Promise.all([
			td.loadSettings(),
			td.board(),
			td.sysinfo(),
			td.wan(),
			ui.menu.load().then(menu => Promise.all([ menu, td.menuHas(menu, 'network/wireless') ? td.wifiInfo() : null ])),
			td.uciType('firewall', 'defaults'),
			td.readFile('/sys/module/mt7915e/parameters/wed_enable'),
			td.readFile('/proc/sys/net/ipv4/tcp_congestion_control'),
			td.readFile('/proc/stat'),
			td.readFile('/proc/net/dev')
		]);
	},

	render([ conf, board, info, wan, [ menu, wifi ], fw, wed, cc, stat, dev ]) {
		const hidden = String(conf.hidden_cards || '').split(/[\s,]+/).filter(Boolean);
		const showOC = conf.plugin_openclash == '1' && td.menuHas(menu, 'services/openclash');
		const mode = wan && wan.up ? wan.mode : 'wan';
		/* wifiInfo() always returns an object; only actual radios mean the box has Wi-Fi. */
		const hasWifi = !!(wifi && Object.keys(wifi.radios || {}).length);

		this.s = {
			down: new Array(N).fill(0), up: new Array(N).fill(0),
			last: null, cpu: td.cpuStat(stat), cpuPct: null, wan: wan, wifi: wifi || { radios: {}, aps: [] }, info: info, board: board,
			clients: [], ping: null, oc: showOC, hasWifi: hasWifi, mode: mode, page: 0
		};

		const fwd = Object.values(fw || {})[0] || {};
		const tags = [];
		this.s.offload = fwd.flow_offloading_hw == '1' ? T('硬件流量卸载', 'Hardware offload')
			: fwd.flow_offloading == '1' ? T('软件流量卸载', 'Software offload') : '';
		if (/^Y/.test(wed || '')) tags.push(T('无线加速 WED', 'Wireless offload (WED)'));
		if (/bbr/.test(cc || '')) tags.push(T('BBR 拥塞控制', 'BBR congestion control'));
		this.s.tags = tags;

		this.hidden = hidden;
		let n = 1;
		const card = (key, cls, inner) => hidden.indexOf(key) > -1 ? '' : `<section class="td-card ${cls}" data-card="${key}" style="--i:${n++}">${inner}</section>`;
		const col = c => c.length ? `<div class="td-col">${c.join('')}</div>` : '';

		/* Topology follows how this box is wired: main router (upstream → this → devices) or
		 * side router / AP, which hangs off the main router next to the other devices. */
		const UP = { wan: [ 'modem', T('上级网络', 'Upstream') ], sta: [ 'wifi', T('上级 Wi‑Fi', 'Upstream Wi‑Fi') ], side: [ 'router', T('主路由', 'Main router') ] }[mode];
		const link = (attr, tid) => `<div class="td-link"${attr}><span class="t" id="${tid}">&nbsp;</span><div class="ln"><i></i><i></i></div></div>`;
		const nUp = `<div class="td-node" id="td-up-node"><div class="ic">${icon(UP[0])}</div><b>${esc(UP[1])}</b><small id="td-proto">—</small></div>`;
		const nMe = `<div class="td-node me"><div class="ic">${icon('router')}</div><b>${esc(board.hostname || 'OpenWrt')}</b><small>${esc(mode == 'side' ? T('旁路由', 'Side router') : T('这台路由器', 'This router'))}</small></div>`;
		const nDev = `<div class="td-node"><div class="ic">${icon('devices')}</div><b id="td-ndev">—</b><small id="td-ndev-s">&nbsp;</small></div>`;
		const lUp = link(' id="td-link-up"', 'td-lat'), lLan = link('', 'td-lan-t');
		const topo = mode == 'side' ? nMe + lUp + nUp + lLan + nDev : nUp + lUp + nMe + lLan + nDev;
		/* A side router receives and resends the same packets on one LAN port, so "down/up" would just
		 * be the same number twice: show one "forwarded" figure instead. */
		const rate = (id, label, cls) => `<div class="td-rate${cls || ''}"><small><i></i>${esc(label)}</small><span class="td-big" id="td-${id}">0</span><span class="td-unit" id="td-${id}-u">Kbps</span></div>`;
		const rates = (mode == 'side' ? rate('down', T('经过本机', 'Through this box'))
		                              : rate('down', T('下载', 'Download')) + rate('up', T('上传', 'Upload'), ' up'))
			+ `<div class="td-rate boot"><small>${esc(T('本次开机', 'Since boot'))}</small><span id="td-boot">—</span></div>`;
		const rateCard = card('rate', 'k-rate', `
					<div class="td-card-h"><h3>${esc(T('实时速率', 'Live traffic'))}</h3><span class="td-muted">${esc(T('过去 2 分钟', 'Last 2 minutes'))}</span></div>
					<div class="td-rates">${rates}</div>
					<svg class="td-chart" id="td-chart" viewBox="0 0 600 118" preserveAspectRatio="none" aria-hidden="true"></svg>`);

		/* Cards below the top row, in reading order. Each goes into whichever column is shorter so far
		 * (rough heights), so the two columns stay balanced whatever is hidden or missing. */
		const H = { dev: 6, wifi: 4, sys: 3.5, oc: 4, ports: 2, disk: 2, actions: 3 }, cols = [ [], [] ], h = [ 0, 0 ];
		for (const [ k, html ] of [
			[ 'dev', card('dev', 'k-dev', `
					<div class="td-card-h"><h3>${esc(T('在线设备', 'Online devices'))}</h3><a href="${L.url('admin/clients')}">${esc(T('全部', 'All'))}${icon('chev')}</a></div>
					<div id="td-devs"><div class="td-empty-row">${esc(T('正在读取…', 'Loading…'))}</div></div>`) ],
			[ 'wifi', this.s.hasWifi ? card('wifi', 'k-wifi', `
					<div class="td-card-h"><h3>Wi‑Fi</h3><a href="${L.url('admin/network/wireless')}">${esc(T('设置', 'Settings'))}${icon('chev')}</a></div>
					<div id="td-wifi"></div>`) : '' ],
			[ 'sys', card('sys', 'k-sys', `
					<div class="td-card-h"><h3>${esc(T('路由器状态', 'Router status'))}</h3>${this.s.offload ? `<span class="td-tag">${icon('check')}${esc(this.s.offload)}</span>` : ''}</div>
					<div class="td-rings">
						${this.ring('cpu', T('处理器', 'CPU'))}
						${this.ring('mem', T('内存', 'Memory'))}
						${this.ring('temp', T('温度', 'Temperature'), 'warm')}
					</div>
					<div class="td-tags" id="td-tags"></div>`) ],
			[ 'oc', showOC ? `<section class="td-card k-proxy" data-card="oc" style="--i:${n++}">
					<div class="td-card-h"><h3>OpenClash</h3><span class="td-chip mute" id="td-oc-chip"><span class="td-dot"></span>${esc(T('读取中', 'Loading'))}</span></div>
					<dl class="td-kv">
						<div><dt>${esc(T('运行模式', 'Run mode'))}</dt><dd id="td-oc-run">—</dd></div>
						<div><dt>${esc(T('配置文件', 'Config'))}</dt><dd id="td-oc-cfg">—</dd></div>
					</dl>
					<div class="td-seg" id="td-oc-seg">
						<button type="button" data-m="rule">${esc(T('按规则', 'Rule'))}</button><button type="button" data-m="global">${esc(T('全局', 'Global'))}</button><button type="button" data-m="direct">${esc(T('直连', 'Direct'))}</button>
					</div>
					<a class="btn block" href="${L.url('admin/services/openclash')}">${esc(T('打开 OpenClash', 'Open OpenClash'))}${icon('arrow')}</a>
				</section>` : '' ],
			[ 'ports', card('ports', 'k-ports', `
					<div class="td-card-h"><h3>${esc(T('网口', 'Ports'))}</h3><span class="td-muted" id="td-ports-n"></span></div>
					<dl class="td-kv" id="td-ports"></dl>`) ],
			[ 'disk', card('disk', 'k-disk', `
					<div class="td-card-h"><h3>${esc(T('存储空间', 'Storage'))}</h3></div>
					<div id="td-disk"></div>`) ],
			[ 'actions', card('actions', 'k-actions', `
					<div class="td-card-h"><h3>${esc(T('常用操作', 'Quick actions'))}</h3></div>
					<div class="td-acts">
						${this.act('admin/system/flash', 'backup', T('备份配置', 'Back up'))}
						${this.act('admin/system/package-manager', 'box', T('软件包', 'Software'))}
						${this.act('admin/network/diagnostics', 'pulse', T('网络诊断', 'Diagnostics'))}
						${this.act('admin/status/logs', 'doc', T('查看日志', 'Logs'))}
					</div>`) ]
		]) if (html) { const c = h[1] < h[0] ? 1 : 0; cols[c].push(html); h[c] += H[k]; }

		const root = td.html(`<div class="td-home">
			<div class="td-head">
				<div>
					<p class="td-eyebrow" id="td-today"></p>
					<h1 class="td-serif" id="td-greet">${esc(T('你好', 'Hello'))}</h1>
					<p class="td-sub" id="td-summary">&nbsp;</p>
				</div>
				<a class="btn" href="${L.url('admin/system/reboot')}">${icon('refresh')}${esc(T('重启路由器', 'Reboot'))}</a>
			</div>

			<div class="td-grid"><div class="td-pair">
				<section class="td-card k-conn" data-card="conn">
					<div class="td-card-h"><h3>${esc(T('网络连接', 'Connection'))}</h3><span class="td-chip" id="td-conn-chip"></span></div>
					<div class="td-topo">${topo}</div>
					<div class="td-facts" id="td-facts">
						<div class="td-facts-view" id="td-facts-view">
							<dl class="td-fact-row td-fact-page td-fact-main">
								<div><dt>${esc(mode == 'side' ? T('本机地址', 'Address') : T('上网地址', 'WAN address'))}</dt><dd id="td-wanip">—</dd><dd class="td-fact-sub" id="td-wanip6" hidden></dd></div>
								<div><dt>${esc(T('网关延迟', 'Gateway latency'))}</dt><dd id="td-ping">—</dd></div>
								<div><dt>DNS</dt><dd id="td-dns">—</dd></div>
								<div><dt class="td-fact-state"><span class="td-dot" id="td-wan-dot"></span>${esc(T('已连接', 'Connected for'))}</dt><dd id="td-wanup">—</dd></div>
							</dl>
						</div>
						<div class="td-facts-dots" id="td-facts-dots" hidden></div>
					</div>
				</section>

				${rateCard}
			</div><div class="td-cols">${col(cols[0])}${col(cols[1])}</div></div>
		</div>`);

		this.root = root;
		this.$ = id => root.querySelector('#' + id);

		this.$('td-facts-dots').addEventListener('click', ev => {
			const b = ev.target.closest('button');
			if (b) this.setPage(+b.dataset.i);
		});

		this.greet();
		this.paintStatic();
		this.paintWifi(this.s.wifi);
		this.paintDisk();
		this.refreshPorts();
		this.ticks = 0;
		this.sample(dev, info);
		this.refreshClients();
		this.pingGateway();

		poll.add(L.bind(this.tick, this), 2);
		poll.add(L.bind(this.slow, this), 10);

		if (showOC) this.loadOC();

		requestAnimationFrame(() => requestAnimationFrame(() => { this.paintRings(); this.layoutPair(); }));
		if (document.fonts && document.fonts.ready)
			document.fonts.ready.then(() => { if (root.isConnected) this.layoutPair(); });

		this.onResize = () => {
			if (!root.isConnected) {
				window.removeEventListener('resize', this.onResize);
				return;
			}
			cancelAnimationFrame(this.raf);
			this.raf = requestAnimationFrame(() => this.layoutPair());
		};
		window.addEventListener('resize', this.onResize);

		return root;
	},

	ring(key, label, cls) {
		return `<div class="td-ring"><svg viewBox="0 0 58 58"><circle class="bg" cx="29" cy="29" r="24"/><circle class="fg ${cls || ''}" id="td-ring-${key}" cx="29" cy="29" r="24" style="stroke-dasharray:${RING};stroke-dashoffset:${RING}"/></svg><div><b id="td-ring-${key}-v">—</b><small id="td-ring-${key}-l">${esc(label)}</small></div></div>`;
	},

	act(path, ic, title) {
		return `<a class="td-act" href="${L.url(path)}">${icon(ic)}<b>${esc(title)}</b></a>`;
	},

	set(id, text) {
		const el = this.$(id);
		if (el && el.textContent !== String(text)) el.textContent = text;
	},

	greet() {
		const d = new Date(), h = d.getHours();
		const hi = T(h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好',
		             h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
		const ok = this.s.wan && this.s.wan.up;
		this.set('td-greet', ok ? hi + T('，一切都好', ', all good') : T('网络好像断开了', 'You seem to be offline'));
		this.set('td-today', td.ZH ? `星期${'日一二三四五六'[d.getDay()]} · ${d.getMonth() + 1} 月 ${d.getDate()} 日`
		                           : d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }));
	},

	paintStatic() {
		const w = this.s.wan;
		const bands = [...new Set((this.s.wifi.aps || []).filter(a => a.up && a.stations.length).map(a => td.bandName(a.band)))];

		this.set('td-lan-t', this.s.mode == 'side' ? T('局域网', 'LAN') : bands.length ? 'Wi‑Fi ' + bands.join(' / ') : T('有线', 'Wired'));

		const ok = !!(w && w.up), chip = this.$('td-conn-chip');
		this.$('td-up-node').classList.toggle('bad', !ok);
		this.$('td-link-up').classList.toggle('down', !ok);
		this.$('td-wan-dot').classList.toggle('bad', !ok);
		if (chip.dataset.ok != String(ok)) {
			chip.dataset.ok = ok;
			chip.className = ok ? 'td-chip' : 'td-chip bad';
			chip.innerHTML = ok ? `<span class="td-dot live"></span>${esc(T('畅通', 'Online'))}` : `<span class="td-dot"></span>${esc(T('未连接', 'Offline'))}`;
		}

		this.paintUplinks();

		const v6 = ok && w.ip6 && w.ip6 != w.ip ? w.ip6 : '';
		this.set('td-wanip6', v6);
		this.$('td-wanip6').hidden = !v6;
		this.$('td-wanip6').title = v6;

		if (!ok) {
			this.set('td-proto', T('没有连接', 'Not connected'));
			this.set('td-wanup', '—');
			return;
		}

		this.set('td-proto', this.s.mode == 'side' ? w.gw || '—' : this.s.mode == 'sta' ? T('无线中继', 'Wi‑Fi uplink') : PROTO[w.proto] || w.proto || '—');
		this.set('td-wanip', w.ip || w.ip6 || '—');
		this.set('td-dns', td.dnsName(w.dns, w.gw, this.s.mode == 'side' ? T('主路由', 'Main router') : null));
		this.set('td-wanup', w.uptime ? td.duration(w.uptime) : '—');

		this.paintTags();
	},

	/* Each dial-up (IPTV, backup WAN) becomes another page in the facts carousel. The IPv6
	 * address belongs to the WAN page, not to an uplink page. */
	paintUplinks() {
		const view = this.$('td-facts-view');
		if (!view) return;
		const list = (this.s.wan && this.s.wan.uplinks) || [];
		const html = list.map(u => {
			const addr = u.ip || u.ip6 || T('未连接', 'Not connected');
			const proto = PROTO[u.proto] || u.proto;
			const dns = (u.dns || []).join(', ');
			const label = `${esc(u.name)}${esc(T('地址', ' address'))}${proto ? ` · ${esc(proto)}` : ''}`;
			return `<dl class="td-fact-row td-fact-page td-fact-uplink">`
				+ `<div><dt>${label}</dt><dd${u.up ? '' : ' class="td-muted"'}>${esc(addr)}</dd></div>`
				+ `<div><dt>DNS</dt><dd${dns ? '' : ' class="td-muted"'}>${esc(dns || '—')}</dd></div>`
				+ `<div><dt class="td-fact-state"><span class="td-dot${u.up ? '' : ' bad'}"></span>${esc(T('已连接', 'Connected for'))}</dt><dd>${u.uptime ? esc(td.duration(u.uptime)) : '—'}</dd></div>`
				+ `</dl>`;
		}).join('');
		if (html != this.s.uplinks) {
			view.querySelectorAll('.td-fact-uplink').forEach(n => n.remove());
			view.insertAdjacentHTML('beforeend', html);
			this.s.uplinks = html;
			this.syncFacts();
		}
	},

	/* Dots only exist with more than one page; one page reads as a plain facts row. */
	syncFacts() {
		const view = this.$('td-facts-view'), dots = this.$('td-facts-dots');
		if (!view) return;
		const labels = [ T('宽带', 'Broadband') ].concat(((this.s.wan && this.s.wan.uplinks) || []).map(u => u.name));
		const n = view.children.length;
		if (dots) {
			dots.hidden = n < 2;
			dots.innerHTML = n > 1
				? labels.slice(0, n).map((l, i) => `<button type="button" class="td-facts-dot" data-i="${i}" aria-label="${esc(l)}"></button>`).join('')
				: '';
		}
		this.setPage(this.s.page);
	},

	setPage(i) {
		const view = this.$('td-facts-view'), dots = this.$('td-facts-dots');
		if (!view) return;
		const n = view.children.length;
		this.s.page = Math.max(0, Math.min(i, n - 1));
		view.style.transform = `translateX(-${this.s.page * 100}%)`;
		if (dots) [ ...dots.children ].forEach((d, k) => d.classList.toggle('on', k == this.s.page));
	},

	/* The rate card keeps the connection card's height: dial-ups are carousel pages, so the
	 * connection card is already at its one-page height. The lower right column is pulled up
	 * under the rate card, so the cards below start right after it. */
	layoutPair() {
		const root = this.root;
		if (!root || !root.isConnected) return;
		const pair = root.querySelector('.td-pair');
		const conn = root.querySelector('[data-card="conn"]');
		const rate = root.querySelector('[data-card="rate"]');
		const cols = root.querySelector('.td-cols');
		const right = cols && cols.children.length > 1 ? cols.lastElementChild : null;
		if (!pair || !conn || !rate) return;

		const wide = getComputedStyle(pair).gridTemplateColumns.trim().split(/\s+/).length > 1;
		if (!wide) {
			rate.style.height = '';
			if (right) right.style.marginTop = '';
			return;
		}

		const connH = conn.getBoundingClientRect().height;
		rate.style.height = '';
		const natural = rate.getBoundingClientRect().height;
		const rateH = Math.round(Math.max(connH, natural));
		rate.style.height = rateH + 'px';

		if (right) {
			const shift = Math.max(0, Math.round(connH - rateH));
			right.style.marginTop = shift ? `-${shift}px` : '';
		}
	},

	paintTags() {
		const box = this.$('td-tags');
		if (box)
			box.innerHTML = this.s.tags.map(t => `<span class="td-tag">${icon('check')}${esc(t)}</span>`).join('');
	},

	paintWifi(wifi) {
		const box = this.$('td-wifi');
		this.s.wifi = wifi;
		if (!box) return;

		const radios = wifi.radios || {}, aps = wifi.aps || [];
		const devs = k => k + ' ' + T('台', k == 1 ? 'client' : 'clients');
		const n = aps.reduce((a, ap) => a + ap.stations.length, 0);
		const guest = aps.find(a => (a.network || []).some(x => /guest/i.test(x)));
		/* The headline is the network people mostly join: 5 GHz first (2.4 GHz is often the
		 * smart-home one), never the guest network. A band with another name shows it on its tile. */
		const rank = ap => (ap.up ? 10 : 0) + (ap == guest ? -5 : 0) + ({ '5g': 3, '6g': 2, '2g': 1 }[ap.band] || 0);
		const main = aps.slice().sort((a, b) => rank(b) - rank(a))[0];
		const tile = (label, value, sub, off) => `<div${off ? ' class="off"' : ''}><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${sub ? `<dd>${esc(sub)}</dd>` : ''}</div>`;

		const tiles = Object.keys(radios).sort((a, b) => String((radios[a].config || {}).band).localeCompare(String((radios[b].config || {}).band))).map(r => {
			const c = radios[r].config || {}, iw = (radios[r].iwinfo || {});
			const on = radios[r].up && !c.disabled;
			const width = String(c.htmode || '').replace(/^[A-Z]+/, '');
			const mine = aps.filter(a => a.radio == r && a != guest);
			const other = [ ...new Set(mine.filter(a => a.ssid && a.ssid != (main || {}).ssid).map(a => a.ssid)) ].join(' / ');
			return tile(td.bandName(c.band) + (other ? ' · ' + other : ''),
				on ? devs(mine.reduce((a, ap) => a + ap.stations.length, 0)) : T('已关闭', 'Off'),
				on ? `${T('信道', 'Ch')} ${iw.channel || c.channel || 'auto'}${width ? ` · ${width} MHz` : ''}` : '', !on);
		});

		if (guest)
			tiles.push(tile(T('访客网络', 'Guest network'), guest.up ? devs(guest.stations.length) : T('未开启', 'Off'), guest.ssid, !guest.up));

		box.innerHTML = (main
			? `<div class="td-ssid">${esc(main.ssid || '—')}</div><p class="td-muted td-ssid-s">${esc(n + ' ' + T('台设备已连接', n == 1 ? 'device connected' : 'devices connected'))}</p>`
			: `<div class="td-ssid td-muted">${esc(T('未开启', 'Off'))}</div><p class="td-muted td-ssid-s">${esc(T('这台路由器还没有开启无线网络', 'No wireless network is enabled'))}</p>`)
			+ (tiles.length ? `<dl class="td-kv">${tiles.join('')}</dl>` : '');
	},

	/* ---------- ports and storage: one port query every 30 s, storage comes with the system info we already poll ---------- */

	refreshPorts() {
		if (!this.$('td-ports')) return Promise.resolve();
		return td.ports(this.s.wan).then(list => {
			const lan = list.filter(p => p.role == 'LAN');
			let k = 0;
			this.set('td-ports-n', T(`${list.filter(p => p.up).length} / ${list.length} 已接网线`, `${list.filter(p => p.up).length} of ${list.length} in use`));
			this.$('td-ports').innerHTML = list.map(p => {
				const m = /^lan(\d+)$/.exec(p.name);
				const name = p.role != 'LAN' ? p.role : m ? 'LAN ' + m[1] : lan.length > 1 ? 'LAN ' + ++k : 'LAN';
				const speed = !p.up ? T('未接网线', 'Unplugged') : p.speed > 0 ? (p.speed >= 1000 ? p.speed / 1000 + ' Gbps' : p.speed + ' Mbps') : T('已连接', 'Connected');
				return `<div${p.up ? '' : ' class="off"'}><dt>${esc(name)}</dt><dd>${esc(speed)}</dd></div>`;
			}).join('');
		});
	},

	paintDisk() {
		const box = this.$('td-disk');
		if (!box) return;
		const info = this.s.info || {};
		const row = (label, d) => {
			if (!d || !d.total) return '';
			const used = d.used != null ? d.used : d.total - d.free, pct = Math.round(used / d.total * 100);
			return `<div class="td-meter"><p><b>${esc(label)}</b><span>${esc(T(`剩余 ${td.bytes((d.avail != null ? d.avail : d.free) * 1024)} / 共 ${td.bytes(d.total * 1024)}`,
				`${td.bytes((d.avail != null ? d.avail : d.free) * 1024)} free of ${td.bytes(d.total * 1024)}`))}</span></p><div class="td-bar${pct >= 90 ? ' full' : ''}"><i style="width:${pct}%"></i></div></div>`;
		};
		const html = row(T('系统空间', 'System'), info.root) + row(T('临时文件', 'Temporary files'), info.tmp) + row(T('虚拟内存', 'Swap'), info.swap);
		if (html != this.s.disk) box.innerHTML = this.s.disk = html;
	},

	refreshClients() {
		return td.clients(this.s.wifi, this.s.wan).then(list => {
			const online = list.filter(c => c.online);
			this.s.clients = online;
			this.set('td-ndev', online.length + ' ' + T('台设备', online.length == 1 ? 'device' : 'devices'));
			this.set('td-ndev-s', online.length ? T('正在上网', 'online') : T('暂无设备', 'none yet'));
			this.paintSummary();

			const box = this.$('td-devs');
			if (!box) return;

			const top = online.slice(0, 6);
			box.innerHTML = top.length ? top.map(c => {
				const [ sig ] = td.signal(c.signal);
				const sub = c.conn == 'wifi' ? `Wi‑Fi ${td.bandName(c.band)} · ${sig}` : T('有线连接', 'Wired') + (c.ip && c.ip != c.display ? ' · ' + c.ip : '');
				const rt = c.conn == 'wifi' && c.link
					? `${Math.round(c.link)} Mbps<div class="td-bar"><i style="width:${td.quality(c.signal)}%"></i></div>`
					: `${esc(T('有线', 'Wired'))}<div class="td-bar"><i style="width:100%"></i></div>`;
				return `<div class="td-dev"><div class="td-av">${icon(c.kind)}</div><div class="nm"><b>${esc(c.display)}</b><small>${esc(sub)}</small></div><div class="rt" title="${esc(T('连接速率 · 信号强度', 'Link rate · signal'))}">${rt}</div></div>`;
			}).join('') + (online.length > 6 ? `<a class="td-more" href="${L.url('admin/clients')}">${esc(T(`还有 ${online.length - 6} 台设备`, `${online.length - 6} more`))}</a>` : '')
			: `<div class="td-empty-row">${esc(T('现在没有设备在线', 'No devices online'))}</div>`;
		});
	},

	paintSummary() {
		const info = this.s.info || {}, n = this.s.clients.length;
		const host = (this.s.board || {}).hostname || T('路由器', 'Router');
		if (!this.s.wan || !this.s.wan.up) {
			this.set('td-summary', T('上级网络没有响应，检查一下光猫或网线是否接好。', 'The upstream network is not responding. Check the modem and cables.'));
			return;
		}
		this.set('td-summary', td.ZH
			? `${host} 已平稳运行 ${td.duration(info.uptime)}，${n} 台设备在线。`
			: `${host} has been up for ${td.duration(info.uptime)} with ${n} device${n == 1 ? '' : 's'} online.`);
	},

	sample(devText, info) {
		const now = Date.now();
		const w = this.s.wan;
		const nd = td.netdev(devText);
		const d = w && nd[w.device];

		if (info) this.s.info = info;

		if (d && this.s.last && now - this.s.last.t < 10000) {
			const dt = Math.max(0.5, (now - this.s.last.t) / 1000);
			const rx = Math.max(0, (d.rx - this.s.last.rx) / dt), tx = Math.max(0, (d.tx - this.s.last.tx) / dt);
			this.s.down.push(rx); this.s.down.shift();
			this.s.up.push(tx); this.s.up.shift();
			const [ dv, du ] = td.rate(rx), [ uv, uu ] = td.rate(tx);
			this.set('td-down', dv); this.set('td-down-u', du);
			this.set('td-up', uv); this.set('td-up-u', uu);
			this.drawChart();
		}

		if (d) {
			this.s.last = { t: now, rx: d.rx, tx: d.tx };
			this.set('td-boot', this.s.mode == 'side' ? td.bytes(d.rx) : `↓ ${td.bytes(d.rx)}  ↑ ${td.bytes(d.tx)}`);
		}

		this.paintRings();
	},

	drawChart() {
		const svg = this.$('td-chart');
		if (!svg) return;

		const down = this.s.down, up = this.s.up;
		const max = Math.max(1, ...down, ...up) * 1.15;
		const W = 600, H = 118;
		const path = (a, close) => {
			const p = a.map((v, i) => [ i * W / (a.length - 1), H - 6 - (v / max) * (H - 22) ]);
			let s = `M${p[0]}`;
			for (let i = 0; i < p.length - 1; i++) {
				const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
				s += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2}`;
			}
			return close ? s + `L${W},${H}L0,${H}Z` : s;
		};

		svg.innerHTML = `<defs><linearGradient id="td-gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.26"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>`
			+ `<path d="${path(down, true)}" fill="url(#td-gd)"/>`
			+ `<path d="${path(down)}" fill="none" style="stroke:var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`
			+ (this.s.mode == 'side' ? '' : `<path d="${path(up)}" fill="none" style="stroke:var(--second)" stroke-width="1.6" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>`);
	},

	paintRings() {
		const setRing = (key, pct, text, label, cls) => {
			const c = this.$('td-ring-' + key);
			if (!c) return;
			c.style.strokeDashoffset = RING * (1 - Math.max(0, Math.min(100, pct || 0)) / 100);
			if (cls != null) c.setAttribute('class', 'fg ' + cls);
			this.set('td-ring-' + key + '-v', text);
			if (label) this.set('td-ring-' + key + '-l', label);
		};

		const info = this.s.info || {}, m = info.memory || {};
		if (this.s.cpuPct != null) setRing('cpu', this.s.cpuPct, Math.round(this.s.cpuPct) + '%');
		else if (info.load) setRing('cpu', Math.min(100, info.load[0] / 65536 * 50), (info.load[0] / 65536).toFixed(2));

		if (m.total) {
			const used = (m.total - (m.available || (m.free + (m.buffered || 0) + (m.cached || 0)))) / m.total * 100;
			setRing('mem', used, Math.round(used) + '%');
		}

		if (this.s.temp != null) {
			const t = this.s.temp;
			setRing('temp', t, Math.round(t) + '°C',
				T('温度', 'Temp') + ' · ' + (t < 70 ? T('正常', 'normal') : t < 85 ? T('偏高', 'warm') : T('过热', 'hot')),
				t < 85 ? 'warm' : 'hot');
		}
		else setRing('temp', 0, '—');
	},

	tick() {
		return Promise.all([ td.readFile('/proc/net/dev'), td.readFile('/proc/stat'), td.temperature() ]).then(([ dev, stat, temp ]) => {
			const c = td.cpuStat(stat);
			if (c && this.s.cpu && c.total > this.s.cpu.total)
				this.s.cpuPct = 100 * (1 - (c.idle - this.s.cpu.idle) / (c.total - this.s.cpu.total));
			if (c) this.s.cpu = c;
			if (temp != null) this.s.temp = temp;
			this.sample(dev);
		});
	},

	slow() {
		return Promise.all([ td.sysinfo(), td.wan(), this.s.hasWifi ? td.wifiInfo() : this.s.wifi ]).then(([ info, wan, wifi ]) => {
			this.s.info = info;
			const was = this.s.wan && this.s.wan.up;
			this.s.wan = wan;
			if (!!(wan && wan.up) != !!was) { this.greet(); }
			this.paintWifi(wifi);
			this.paintStatic();
			this.layoutPair();
			this.paintDisk();
			this.pingGateway();
			return Promise.all([ this.refreshClients(), ++this.ticks % 3 ? null : this.refreshPorts() ]);
		});
	},

	pingGateway() {
		const w = this.s.wan;
		if (!w || !w.gw || !/^[0-9.]+$/.test(w.gw)) {
			this.set('td-lat', w && w.up ? T('已连接', 'Connected') : T('未连接', 'Offline'));
			return Promise.resolve();
		}
		return L.resolveDefault(fs.exec('/bin/ping', [ '-c', '1', '-W', '1', w.gw ]), {}).then(r => {
			const m = String((r || {}).stdout || '').match(/time[=<]([\d.]+)/);
			const v = m ? (+m[1] < 1 ? '<1' : Math.round(+m[1])) + ' ms' : null;
			this.set('td-ping', v || T('无响应', 'No reply'));
			this.set('td-lat', v ? T('延迟 ', 'Latency ') + v : T('已连接', 'Connected'));
		});
	},

	/* ---------- optional OpenClash card: one procd + one uci read, no polling ---------- */

	loadOC() {
		const mark = m => this.root.querySelectorAll('#td-oc-seg button').forEach(b => b.classList.toggle('on', b.dataset.m == m));
		let mode = null;

		this.$('td-oc-seg').addEventListener('click', ev => {
			const b = ev.target.closest('button[data-m]');
			if (!b || b.dataset.m == mode) return;
			const prev = mode;
			mark(mode = b.dataset.m);
			request.get(L.url('admin/services/openclash/switch_rule_mode'), { query: { rule_mode: mode } })
				.then(r => { if (!r.ok) throw r; td.toast(T('已切换代理模式', 'Proxy mode switched')); })
				.catch(() => { mark(mode = prev); td.toast(T('切换失败', 'Switch failed')); });
		});

		return Promise.all([ td.service('openclash'), td.uciSection('openclash', 'config') ]).then(([ svc, c ]) => {
			const inst = ((svc.openclash || {}).instances || {});
			const running = Object.keys(inst).some(k => inst[k].running);
			const chip = this.$('td-oc-chip');
			chip.className = 'td-chip' + (running ? '' : ' mute');
			chip.innerHTML = `<span class="td-dot${running ? ' live' : ''}"></span>${esc(running ? T('运行中', 'Running') : T('未运行', 'Stopped'))}`;

			const run = String(c.en_mode || c.operation_mode || '');
			this.set('td-oc-run', run ? run.replace(/^fake-ip/, 'Fake-IP').replace(/^redir-host/, 'Redir-Host').replace(/-(tun|mix)$/, s => ' · ' + s.slice(1).toUpperCase()) : '—');
			const cfg = String(c.config_path || '').split('/').pop().replace(/\.ya?ml$/, '');
			this.set('td-oc-cfg', cfg || '—');
			this.$('td-oc-cfg').title = cfg;
			mark(mode = c.proxy_mode || 'rule');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
