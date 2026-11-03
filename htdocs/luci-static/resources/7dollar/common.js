'use strict';
'require baseclass';
'require rpc';
'require fs';
'require ui';

/*
 * Shared helpers for the 7Dollar theme: menu grouping, settings storage,
 * formatting and the device list used by the home and devices pages.
 */

const ZH = /^zh/i.test(document.documentElement.getAttribute('lang') || '');
const T = (zh, en) => ZH ? zh : en;
const MEDIA = (L.env.media || '/luci-static/7dollar');
const SPRITE = '/luci-static/7dollar/icons.svg';

const callUciGet = rpc.declare({ object: 'uci', method: 'get', params: [ 'config', 'section' ], expect: { values: {} } });
const callUciGetType = rpc.declare({ object: 'uci', method: 'get', params: [ 'config', 'type' ], expect: { values: {} } });
const callUciSet = rpc.declare({ object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ] });
const callUciAdd = rpc.declare({ object: 'uci', method: 'add', params: [ 'config', 'type', 'name', 'values' ] });
const callUciDelete = rpc.declare({ object: 'uci', method: 'delete', params: [ 'config', 'section', 'options' ] });
const callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ] });
const callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });
const callWireless = rpc.declare({ object: 'luci-rpc', method: 'getWirelessDevices', expect: { '': {} } });
const callAssoc = rpc.declare({ object: 'iwinfo', method: 'assoclist', params: [ 'device' ], expect: { results: [] } });
const callDevices = rpc.declare({ object: 'luci-rpc', method: 'getNetworkDevices', expect: { '': {} } });
const callIfDump = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });
const callBoard = rpc.declare({ object: 'system', method: 'board' });
const callInfo = rpc.declare({ object: 'system', method: 'info' });
const callService = rpc.declare({ object: 'service', method: 'list', params: [ 'name' ], expect: { '': {} } });

const DEFAULTS = { palette: 'clay', mode: 'auto', hidden_cards: '', plugin_openclash: '0' };

const PALETTES = [
	[ 'clay',     T('陶土', 'Clay') ],
	[ 'celadon',  T('青瓷', 'Celadon') ],
	[ 'mist',     T('雾蓝', 'Mist') ],
	[ 'dusk',     T('暮紫', 'Dusk') ],
	[ 'graphite', T('石墨', 'Graphite') ]
];

/* Menu regrouping: native LuCI pages -> seven plain-language sections. */
const GROUPS = [
	{ id: 'home', icon: 'home', label: T('总览', 'Overview'), pages: [ 'admin/home' ] },
	{ id: 'devices', icon: 'devices', label: T('设备', 'Devices'), pages: [ 'admin/clients' ] },
	{ id: 'wifi', icon: 'wifi', label: 'Wi‑Fi', pages: [ 'admin/network/wireless', 'admin/status/channel_analysis' ] },
	{ id: 'internet', icon: 'globe', label: T('上网', 'Internet'),
	  pages: [ 'admin/network/network', 'admin/network/dhcp', 'admin/network/diagnostics', 'admin/network/routes', 'admin/status/routes', 'admin/network/switch' ],
	  prefix: [ 'admin/network' ] },
	{ id: 'security', icon: 'shield', label: T('安全', 'Security'), mob: false,
	  pages: [ 'admin/network/firewall', 'admin/status/nftables', 'admin/status/iptables', 'admin/system/admin' ] },
	{ id: 'apps', icon: 'grid', label: T('应用', 'Apps'), mob: false, pages: [ 'admin/apps' ],
	  prefix: [ 'admin/services', 'admin/vpn', 'admin/nas', 'admin/docker', 'admin/statistics' ] },
	{ id: 'system', icon: 'gear', label: T('系统', 'System'), short: T('更多', 'More'),
	  pages: [ 'admin/system/system', 'admin/system/appearance', 'admin/status/overview', 'admin/status/realtime', 'admin/status/logs',
	           'admin/system/package-manager', 'admin/system/flash', 'admin/system/crontab', 'admin/system/startup', 'admin/status/processes',
	           'admin/system/mounts', 'admin/system/leds', 'admin/system/reboot' ],
	  prefix: [ 'admin/system', 'admin/status' ] }
];

const LABELS = {
	'admin/home': T('总览', 'Overview'),
	'admin/clients': T('设备', 'Devices'),
	'admin/apps': T('全部应用', 'All apps'),
	'admin/network/wireless': T('无线网络', 'Wireless'),
	'admin/status/channel_analysis': T('信道分析', 'Channel analysis'),
	'admin/network/network': T('网络接口', 'Interfaces'),
	'admin/network/dhcp': T('DHCP 与 DNS', 'DHCP & DNS'),
	'admin/network/diagnostics': T('网络诊断', 'Diagnostics'),
	'admin/network/routes': T('静态路由', 'Static routes'),
	'admin/status/routes': T('路由表', 'Routing table'),
	'admin/network/switch': T('交换机', 'Switch'),
	'admin/network/firewall': T('防火墙', 'Firewall'),
	'admin/status/nftables': T('防火墙规则', 'Firewall status'),
	'admin/status/iptables': T('防火墙规则', 'Firewall status'),
	'admin/system/admin': T('管理员', 'Administration'),
	'admin/system/system': T('通用', 'General'),
	'admin/system/appearance': T('外观与首页', 'Appearance'),
	'admin/status/overview': T('运行状态', 'Status'),
	'admin/status/realtime': T('实时监控', 'Realtime'),
	'admin/status/logs': T('日志', 'Logs'),
	'admin/status/processes': T('进程', 'Processes'),
	'admin/system/package-manager': T('软件包', 'Software'),
	'admin/system/flash': T('备份与升级', 'Backup & upgrade'),
	'admin/system/startup': T('启动项', 'Startup'),
	'admin/system/crontab': T('计划任务', 'Scheduled tasks'),
	'admin/system/mounts': T('挂载点', 'Mount points'),
	'admin/system/leds': T('指示灯', 'LEDs'),
	'admin/system/reboot': T('重启', 'Reboot'),
	'admin/services/openclash': 'OpenClash',
	'admin/services/ksmbd': T('文件共享', 'File sharing')
};

const APP_ICONS = [
	[ /clash|passwall|homeproxy|ssr|v2ray|xray|sing|mihomo|proxy|nikki|daed/i, 'route' ],
	[ /smb|samba|ksmbd|nfs|ftp|disk|share|alist|aria|transmission|qbit|minidlna/i, 'folder' ],
	[ /vpn|wireguard|openvpn|zerotier|tailscale|frp|ipsec/i, 'vpn' ],
	[ /ddns|dns|adguard|mosdns|smartdns/i, 'globe' ],
	[ /docker|dockerman/i, 'box' ],
	[ /stat|nlbw|bandwidth|netdata/i, 'pulse' ],
	[ /upnp|qos|sqm|eqos/i, 'sliders' ],
	[ /wol|wake/i, 'power' ],
	[ /cron|sched|time/i, 'clock' ]
];

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function icon(id, cls) {
	return `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="${SPRITE}#${id}"></use></svg>`;
}

function html(s) {
	const t = document.createElement('template');
	t.innerHTML = s.trim();
	return t.content.childNodes.length == 1 ? t.content.firstChild : t.content;
}

function title(path, node) {
	if (LABELS[path])
		return LABELS[path];
	return node && node.title ? _(node.title) : path.split('/').pop();
}

/* ui.menu.getChildren() replaces alias nodes (e.g. Firewall → Zones) with a copy of
 * their target, which drops the alias's own sub-pages. Always keep the real node. */
function realNode(parent, child) {
	return (parent.children && parent.children[child.name]) || child;
}

/* True if the menu has this page. LuCI only lists pages whose dependencies are met, so this
 * doubles as a free feature check (e.g. Wireless needs a wifi-device, OpenClash needs the app). */
function menuHas(tree, path) {
	let n = tree;
	for (const k of ('admin/' + path).split('/')) n = n && n.children && n.children[k];
	return !!n;
}

function flatten(tree) {
	/* Returns [{ path, node, title, group }] for every navigable page. */
	const admin = tree && tree.children && tree.children.admin;
	const out = [];

	if (!admin)
		return out;

	ui.menu.getChildren(admin).forEach(t => {
		const top = realNode(admin, t);

		if (top.name == 'logout')
			return;

		const tpath = 'admin/' + top.name;
		const kids = ui.menu.getChildren(top);

		if (!kids.length)
			out.push({ path: tpath, node: top });
		else
			kids.forEach(k => out.push({ path: tpath + '/' + k.name, node: realNode(top, k) }));
	});

	out.forEach(p => {
		p.title = title(p.path, p.node);
		p.group = groupOf(p.path);
	});

	return out;
}

function groupOf(path) {
	for (const g of GROUPS)
		if (g.pages.indexOf(path) > -1)
			return g.id;

	for (const g of GROUPS)
		for (const pre of (g.prefix || []))
			if (path == pre || path.indexOf(pre + '/') == 0)
				return g.id;

	return 'apps';
}

function grouped(pages) {
	return GROUPS.map(g => {
		const list = pages.filter(p => p.group == g.id);
		list.sort((a, b) => {
			const ia = g.pages.indexOf(a.path), ib = g.pages.indexOf(b.path);
			return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
		});
		return Object.assign({}, g, { list: list });
	}).filter(g => g.list.length);
}

function appIcon(path) {
	for (const [ re, id ] of APP_ICONS)
		if (re.test(path))
			return id;
	return 'grid';
}

/* ---------------- settings (stored in /etc/config/7dollar) ---------------- */

function loadSettings() {
	return L.resolveDefault(callUciGet('7dollar', 'main'), {}).then(v => Object.assign({}, DEFAULTS, v || {}));
}

function saveSettings(values) {
	const set = {}, del = [];

	for (const k in values) {
		if (values[k] === '' || values[k] == null)
			del.push(k);
		else
			set[k] = String(values[k]);
	}

	return L.resolveDefault(callUciGet('7dollar', 'main'), null).then(exists => {
		const steps = [];

		if (exists == null || !Object.keys(exists).length)
			steps.push(() => callUciAdd('7dollar', 'theme', 'main', set));
		else if (Object.keys(set).length)
			steps.push(() => callUciSet('7dollar', 'main', set));

		if (del.length)
			steps.push(() => L.resolveDefault(callUciDelete('7dollar', 'main', del), null));

		steps.push(() => callUciCommit('7dollar'));

		return steps.reduce((p, fn) => p.then(fn), Promise.resolve());
	});
}

/* ---------------- motion ---------------- */

/* Durations live in cascade.css (--fast / --base / --slow); scripts read them so CSS and JS move alike. */
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function motion(name) {
	return calm.matches ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`)) * 1000 || 0;
}

/* Exits mirror entrances: fade (and sink) out, then go. */
function leave(el) {
	if (el.classList.contains('td-out')) return;
	el.classList.add('td-out');
	setTimeout(() => el.remove(), motion('fast'));
}

function applyLook(s) {
	const r = document.documentElement;
	const dark = s.mode == 'auto' ? matchMedia('(prefers-color-scheme: dark)').matches : s.mode == 'dark';
	const paint = () => {
		r.setAttribute('data-palette', s.palette);
		r.setAttribute('data-mode', s.mode);
		r.setAttribute('data-theme', dark ? 'dark' : 'light');
		r.setAttribute('data-darkmode', dark ? 'true' : 'false');
		document.dispatchEvent(new CustomEvent('td-look', { detail: s }));
	};
	/* one cross-fade of the whole page instead of every colour easing on its own */
	if (document.startViewTransition && motion('base')) document.startViewTransition(paint);
	else paint();
}

let toastTimer;
function toast(msg) {
	let t = document.querySelector('.td-toast:not(.td-out)');
	if (!t) document.body.appendChild(t = E('div', { 'class': 'td-toast', 'role': 'status' }));
	t.textContent = msg;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => leave(t), 1800);
}

/* ---------------- formatting ---------------- */

function rate(bytesPerSec) {
	const bits = Math.max(0, bytesPerSec * 8);
	if (bits >= 1e9) return [ (bits / 1e9).toFixed(2), 'Gbps' ];
	if (bits >= 1e6) return [ (bits / 1e6).toFixed(bits >= 1e8 ? 0 : 1), 'Mbps' ];
	if (bits >= 1e3) return [ (bits / 1e3).toFixed(0), 'Kbps' ];
	return [ bits.toFixed(0), 'bps' ];
}

function bytes(n) {
	n = +n || 0;
	if (n >= 1099511627776) return (n / 1099511627776).toFixed(1) + ' TB';
	if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
	if (n >= 1048576) return (n / 1048576).toFixed(0) + ' MB';
	if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
	return n + ' B';
}

function duration(sec) {
	sec = Math.max(0, Math.floor(sec || 0));
	const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
	if (ZH) {
		if (d) return `${d} 天 ${h} 小时`;
		if (h) return `${h} 小时 ${m} 分钟`;
		return `${Math.max(m, 1)} 分钟`;
	}
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	return `${Math.max(m, 1)}m`;
}

function signal(dbm) {
	if (dbm == null || dbm == 0) return [ T('未知', 'Unknown'), 0 ];
	if (dbm >= -55) return [ T('信号很好', 'Excellent'), 4 ];
	if (dbm >= -65) return [ T('信号良好', 'Good'), 3 ];
	if (dbm >= -75) return [ T('信号一般', 'Fair'), 2 ];
	return [ T('信号较弱', 'Weak'), 1 ];
}

function quality(dbm) {
	if (!dbm) return 0;
	return Math.max(4, Math.min(100, Math.round((dbm + 92) / 50 * 100)));
}

function bandName(b) {
	return ({ '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', '60g': '60 GHz' })[b] || b || 'Wi‑Fi';
}

function kind(name) {
	name = name || '';
	if (/watch/i.test(name)) return 'watch';
	if (/ipad|pad|tab|kindle/i.test(name)) return 'tablet';
	if (/iphone|pixel|android|phone|oppo|vivo|xiaomi|redmi|huawei|honor|galaxy|oneplus|realme|meizu|nokia|mi-/i.test(name)) return 'phone';
	if (/tv|roku|chromecast|firestick|shield|box/i.test(name)) return 'tv';
	if (/macbook|laptop|notebook|thinkpad|surface/i.test(name)) return 'laptop';
	if (/mac|imac|mini|pc|desktop|win|ubuntu|linux|nas|server/i.test(name)) return 'desktop';
	return 'devices';
}

function pretty(name) {
	if (!name) return '';
	return name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------------- data ---------------- */

function readFile(path) {
	return L.resolveDefault(fs.read(path), null);
}

/* CPU temperature lives in different places per platform (thermal_zone0 on most SoCs,
 * coretemp/k10temp hwmon on x86). Pick the best sensor once; later reads cost one file. */
const TEMP_PREF = [ /^coretemp/, /^k10temp/, /^zenpower/, /^x86_pkg_temp/, /^cpu[-_]?thermal/, /^soc[-_]?thermal/, /^acpitz/ ];
let tempPath;

function tempSensor() {
	if (tempPath !== undefined)
		return Promise.resolve(tempPath);

	const list = dir => L.resolveDefault(fs.list(dir), []).then(l => l.map(e => dir + '/' + e.name));
	const rank = name => { const i = TEMP_PREF.findIndex(r => r.test(name)); return i < 0 ? TEMP_PREF.length : i };

	return Promise.all([ list('/sys/class/thermal'), list('/sys/class/hwmon') ]).then(([ zones, hwmons ]) => Promise.all([].concat(
		zones.filter(d => /thermal_zone\d+$/.test(d)).map(d => readFile(d + '/type').then(n => ({ name: n, path: d + '/temp' }))),
		hwmons.map(d => readFile(d + '/name').then(n => ({ name: n, path: d + '/temp1_input' })))
	))).then(found => {
		/* Known CPU sensors first, then any thermal zone; never radio/PHY/disk sensors. */
		const cands = found.filter(c => c.name).map(c => ({ path: c.path, r: rank(c.name.trim()) }))
			.filter(c => c.r < TEMP_PREF.length || /thermal_zone/.test(c.path))
			.sort((a, b) => a.r - b.r || (a.path < b.path ? -1 : 1));

		const next = i => i >= cands.length ? null
			: readFile(cands[i].path).then(v => +v > 0 ? cands[i].path : next(i + 1));
		return next(0);
	}).then(p => (tempPath = p));
}

function temperature() {
	return tempSensor().then(p => p ? readFile(p) : null).then(v => +v > 0 ? +v / 1000 : null);
}

function wifiInfo() {
	return L.resolveDefault(callWireless(), {}).then(radios => {
		const aps = [];

		Object.keys(radios || {}).sort().forEach(rname => {
			const r = radios[rname] || {};
			(r.interfaces || []).forEach(i => {
				if ((i.config || {}).mode == 'ap' && i.ifname)
					aps.push({ radio: rname, band: (r.config || {}).band, ifname: i.ifname, ssid: (i.iwinfo || {}).ssid || (i.config || {}).ssid,
					           network: (i.config || {}).network || [], up: !!r.up && !(i.config || {}).disabled });
			});
		});

		return Promise.all(aps.map(ap => ap.up ? L.resolveDefault(callAssoc(ap.ifname), []) : Promise.resolve([])))
			.then(lists => {
				aps.forEach((ap, i) => ap.stations = lists[i] || []);
				return { radios: radios || {}, aps: aps };
			});
	});
}

function clients(wifi, uplink) {
	return Promise.all([
		L.resolveDefault(callLeases(), {}),
		L.resolveDefault(callHints(), {}),
		wifi ? Promise.resolve(wifi) : wifiInfo(),
		readFile('/proc/net/arp'),
		uplink !== undefined ? uplink : wan()
	]).then(([ leases, hints, wi, arp, up ]) => {
		up = up || {};
		/* neighbours on the uplink side (a main router's WAN port, a repeater's Wi-Fi link) are not
		 * our devices; a side router's uplink is the LAN itself, so there only the gateway is skipped */
		const skip = up.mode == 'side' ? [] : [ up.device, up.port ];
		const byMac = {};
		const get = mac => {
			mac = String(mac).toUpperCase();
			return byMac[mac] || (byMac[mac] = { mac: mac, online: false });
		};

		(leases.dhcp_leases || []).forEach(l => {
			if (!l.macaddr) return;
			const c = get(l.macaddr);
			c.name = c.name || l.hostname;
			c.ip = l.ipaddr;
			c.expires = l.expires;
			c.lease = true;
		});

		const wifiMacs = {};

		(wi.aps || []).forEach(ap => ap.stations.forEach(s => {
			const c = get(s.mac);
			const h = (hints || {})[c.mac] || {};
			c.online = true;
			c.conn = 'wifi';
			c.band = ap.band;
			c.ssid = ap.ssid;
			c.signal = s.signal;
			c.link = Math.max((s.tx || {}).rate || 0, (s.rx || {}).rate || 0) / 1000;
			c.since = s.connected_time;
			c.name = c.name || h.name;
			c.ip = c.ip || (h.ipaddrs || [])[0];
			wifiMacs[c.mac] = true;
		}));

		/* Wired devices are whatever answers ARP on our side, leased or not (static IPs, or a side
		 * router whose DHCP is off), whatever the LAN is called (br-lan, eth0, br-lan.10 ...).
		 * The gateway is the upstream router; containers and loopback are not devices either. */
		String(arp || '').split('\n').slice(1).forEach(line => {
			const f = line.trim().split(/\s+/);
			if (f.length < 6 || f[2] != '0x2' || f[0] == up.gw || skip.includes(f[5]) || /^(lo|docker|veth)|^br-[0-9a-f]{12}$/.test(f[5]) || wifiMacs[f[3].toUpperCase()])
				return;
			const c = get(f[3]);
			c.online = true;
			c.conn = 'wired';
			c.ip = c.ip || f[0];
		});

		for (const mac in (hints || {})) {
			const h = hints[mac], c = byMac[mac.toUpperCase()];
			if (c) {
				c.name = c.name || h.name;
				c.ip = c.ip || (h.ipaddrs || h.ipv4 || [])[0];
			}
		}

		const list = Object.values(byMac).map(c => {
			c.display = pretty(c.name) || c.ip || c.mac;
			c.kind = kind(c.name);
			return c;
		});

		list.sort((a, b) => (b.online - a.online) || ((b.link || 0) - (a.link || 0)) || a.display.localeCompare(b.display));

		return list;
	});
}

/* The uplink is whichever device carries the kernel's default route. Asking the kernel instead of
 * netifd covers every layout (main router, bypass/side router, routes added by scripts). */
function defaultRoute(text) {
	let best = null;
	String(text || '').split('\n').slice(1).forEach(line => {
		const f = line.trim().split(/\s+/);
		if (f[1] != '00000000' || f[7] != '00000000' || !(parseInt(f[3], 16) & 1)) return;
		if (!best || +f[6] < best.metric)
			best = { dev: f[0], metric: +f[6], gw: f[2].match(/../g).reverse().map(h => parseInt(h, 16)).join('.') };
	});
	return best;
}

function wan() {
	return Promise.all([ L.resolveDefault(callIfDump(), []), readFile('/proc/net/route') ]).then(([ ifs, rt ]) => {
		const list = ifs || [];
		const def = defaultRoute(rt);
		const dev = i => i.l3_device || i.device;
		const lan = list.find(i => i.interface == 'lan');
		const v6 = i => ((i['ipv6-address'] || []).filter(a => !/^fe80:/i.test(a.address))[0] || {}).address;
		const routed = i => (i.route || []).some(r => r.target == '0.0.0.0' || r.target == '::');
		/* A second default route (IPTV, backup WAN) is another uplink. The DHCPv6 interface
		 * behind a PPPoE WAN is not: its global address belongs to the main uplink. */
		const uplinks = primary => list
			.filter(i => i.interface != 'lan' && i.interface != 'loopback' && i.interface != (primary || {}).interface
			          && dev(i) != dev(primary || {}))
			.filter(routed)
			.map(i => ({ name: i.interface, proto: i.proto, device: i.device, port: i.l3_device, up: !!i.up,
			             ip: ((i['ipv4-address'] || [])[0] || {}).address, ip6: v6(i), dns: i['dns-server'] || [],
			             uptime: i.uptime }));
		const companion6 = x => v6(list.find(j => j !== x && dev(j) == dev(x) && v6(j)) || {});

		if (!def) {
			const w = list.find(i => i.interface == 'wan');
			return w ? { up: false, mode: 'wan', proto: w.proto, device: dev(w), uplinks: uplinks(w) } : null;
		}

		const i = list.filter(i => i.up && dev(i) == def.dev)
			.sort((a, b) => !!(b['ipv4-address'] || []).length - !!(a['ipv4-address'] || []).length)[0] || {};

		return {
			up: true,
			/* side: uplink shares the LAN (bypass router / AP); sta: Wi-Fi uplink (repeater) */
			mode: lan && dev(lan) == def.dev ? 'side' : /-sta\d+$/.test(def.dev) ? 'sta' : 'wan',
			proto: i.proto,
			device: def.dev,
			port: i.device,
			ip: ((i['ipv4-address'] || [])[0] || {}).address,
			ip6: v6(i) || companion6(i),
			gw: def.gw != '0.0.0.0' ? def.gw : null,
			dns: i['dns-server'] || [],
			uptime: i.uptime,
			uplinks: uplinks(i)
		};
	});
}

/* Physical Ethernet ports in use: bridge members plus the ports of every uplink (WAN, IPTV,
 * backup WAN), each tagged with the interface that owns it. A VLAN on top (eth0.7, wan.10)
 * counts as its port. */
function ports(up) {
	const base = n => String(n || '').split('.')[0];
	const roles = {}, rank = {};
	const add = (n, role, r) => {
		n = base(n);
		if (n && !(n in roles)) { roles[n] = role; rank[n] = r; }
	};
	if (up && up.mode != 'side') { add(up.device, 'WAN', 0); add(up.port, 'WAN', 0); }
	((up && up.uplinks) || []).forEach((u, i) => { add(u.device, u.name, i + 1); add(u.port, u.name, i + 1); });
	return L.resolveDefault(callDevices(), {}).then(devs => Object.values(devs || {})
		.filter(d => d.devtype == 'ethernet' && !d.wireless && d.name.indexOf('.') < 0 && !/^(docker|veth|br-)/.test(d.name)
		          && (d.master || roles[d.name]))
		.map(d => ({ name: d.name, role: roles[d.name] || 'LAN', up: !!(d.link || {}).carrier, speed: +(d.link || {}).speed || 0 }))
		.sort((a, b) => ((rank[a.name] != null ? rank[a.name] : 100) - (rank[b.name] != null ? rank[b.name] : 100))
			|| a.name.localeCompare(b.name, 'en', { numeric: true })));
}

const DNS_NAMES = {
	'223.5.5.5': T('阿里', 'AliDNS'), '223.6.6.6': T('阿里', 'AliDNS'),
	'119.29.29.29': T('腾讯', 'DNSPod'), '119.28.28.28': T('腾讯', 'DNSPod'), '182.254.116.116': T('腾讯', 'DNSPod'),
	'114.114.114.114': '114DNS', '114.114.115.115': '114DNS',
	'180.76.76.76': T('百度', 'Baidu'), '1.1.1.1': 'Cloudflare', '1.0.0.1': 'Cloudflare',
	'8.8.8.8': 'Google', '8.8.4.4': 'Google', '9.9.9.9': 'Quad9'
};

function dnsName(list, gw, gwName) {
	const names = [];
	(list || []).forEach(ip => {
		const n = DNS_NAMES[ip] || (ip == gw ? gwName || T('上级路由', 'Upstream') : ip);
		if (names.indexOf(n) < 0) names.push(n);
	});
	return names.slice(0, 2).join(' · ') || '—';
}

function netdev(text) {
	const out = {};
	String(text || '').split('\n').slice(2).forEach(line => {
		const m = line.match(/^\s*([^:]+):\s*(.*)$/);
		if (!m) return;
		const f = m[2].trim().split(/\s+/).map(Number);
		out[m[1]] = { rx: f[0], tx: f[8] };
	});
	return out;
}

function cpuStat(text) {
	const f = String(text || '').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
	if (f.length < 4) return null;
	const idle = f[3] + (f[4] || 0);
	return { idle: idle, total: f.reduce((a, b) => a + b, 0) };
}

return baseclass.extend({
	ZH: ZH, T: T, media: MEDIA, sprite: SPRITE,
	active: /\/7dollar$/.test(L.env.media || ''),
	PALETTES: PALETTES, GROUPS: GROUPS, DEFAULTS: DEFAULTS,
	esc: esc, icon: icon, html: html,
	flatten: flatten, realNode: realNode, menuHas: menuHas, grouped: grouped, groupOf: groupOf, title: title, appIcon: appIcon,
	loadSettings: loadSettings, saveSettings: saveSettings, applyLook: applyLook, toast: toast, motion: motion, leave: leave,
	rate: rate, bytes: bytes, duration: duration, signal: signal, quality: quality, bandName: bandName, kind: kind, pretty: pretty,
	readFile: readFile, temperature: temperature, wifiInfo: wifiInfo, clients: clients, wan: wan, ports: ports, dnsName: dnsName, netdev: netdev, cpuStat: cpuStat,
	board: () => L.resolveDefault(callBoard(), {}),
	sysinfo: () => L.resolveDefault(callInfo(), {}),
	service: name => L.resolveDefault(callService(name), {}),
	uciType: (config, type) => L.resolveDefault(callUciGetType(config, type), {}),
	uciSection: (config, section) => L.resolveDefault(callUciGet(config, section), {}),
	uciSet: (config, section, values) => callUciSet(config, section, values).then(() => callUciCommit(config))
});
