'use strict';
'require baseclass';
'require ui';
'require poll';
'require 7dollar.common as td';
'require 7dollar.tidy as tidy';

/*
 * Navigation for the 7Dollar theme.
 * Native LuCI pages are regrouped into seven plain-language sections;
 * anything unknown falls back to "Apps" so third-party plugins always show up.
 */

const T = td.T, icon = td.icon, esc = td.esc;
const mqPhone = window.matchMedia('(max-width:760px)');
const MENU_CACHE_KEY = '7dollar-menu-version';
const MENU_CACHE_VERSION = '1.1.0';

return baseclass.extend({
	__init__() {
		this.resetMenuCache();
		ui.menu.load().then(L.bind(this.render, this));
		this.bindKeys();
		this.bindMode();
		this.bindVisibility();
		this.bindPollLabel();
		this.bindTabHeading();
		this.bindSectionStructure();
		this.bindIndicators();
	},

	/* ui.menu caches the raw tree in sessionStorage, so a theme switch keeps the old menu */
	resetMenuCache() {
		try {
			if (sessionStorage.getItem(MENU_CACHE_KEY) !== MENU_CACHE_VERSION) {
				ui.menu.flushCache();
				sessionStorage.setItem(MENU_CACHE_KEY, MENU_CACHE_VERSION);
			}
		} catch (e) {}
	},

	/* Every LuCI page refreshes through one shared poll loop; stop it while the tab is hidden so a
	 * forgotten tab costs the router nothing. Coming back restarts it, which refreshes at once. */
	bindVisibility() {
		let paused = false;
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) {
				if (poll.active()) { poll.stop(); paused = true; }
			}
			else if (paused) {
				paused = false;
				poll.start();
			}
		});
	},

	/* LuCI labels the poll pill "Refreshing"/"Paused"; spell out what the green or red dot means. */
	bindPollLabel() {
		const box = document.getElementById('indicators');
		if (!box) return;

		const sync = () => box.querySelectorAll('[data-indicator="poll-status"]').forEach(el => {
			const text = el.getAttribute('data-style') == 'inactive'
				? T('暂停刷新', 'Refresh paused')
				: T('自动刷新中', 'Auto-refreshing');

			if (el.textContent !== text)
				el.textContent = text;
		});

		new MutationObserver(sync).observe(box, {
			childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [ 'data-style' ]
		});

		sync();
	},

	/* Menu tabs already name the page, so repeating the view title below them is noise.
	 * Keep the description under the tabs, the way the Startup page does. */
	bindTabHeading() {
		const main = document.getElementById('maincontent');
		if (!main) return;

		let raf = 0;
		const sync = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const view = document.getElementById('view');
				if (!view) return;

				const tabs = document.querySelector('#tabmenu .tabs');
				let head = null;

				if (tabs)
					for (const h of view.querySelectorAll('h1, h2'))
						if (!h.closest('.cbi-section')) { head = h; break; }

				const old = this._tabHead;
				if (old && old !== head)
					old.classList.remove('td-tab-title-hidden');

				if (head)
					head.classList.add('td-tab-title-hidden');

				this._tabHead = head;
			});
		};

		new MutationObserver(sync).observe(main, { childList: true, subtree: true });
		sync();
	},

	/* DHCP's lease tab puts static leases and the two active-lease tables in one card, and the
	 * static grid ships without a heading. Split the blocks into their own cards, name the one
	 * that has no title, and move long help behind a disclosure. Scoped by page id so no other
	 * view gets its DOM rearranged. */
	bindSectionStructure() {
		const page = document.body.getAttribute('data-page') || '';
		if (page != 'admin-network-dhcp' && page != 'admin-network-dns') return;

		const main = document.getElementById('maincontent');
		if (!main) return;

		const titles = {
			'admin-network-dhcp': {
				'__static_leases__': T('静态租约', 'Static leases')
			}
		}[page] || {};

		let raf = 0;
		const sync = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				this.splitSectionBlocks(main, titles);
				this.collapseSectionHelp(main);
			});
		};

		new MutationObserver(sync).observe(main, { childList: true, subtree: true });
		sync();
	},

	splitSectionBlocks(main, titles) {
		const outer = main.querySelector('.cbi-section[id$="__leases__"]');
		if (!outer || outer.classList.contains('td-section-stack')) return;

		const node = outer.querySelector(':scope > .cbi-section-node');
		if (!node) return;

		const blocks = Array.from(node.children).filter(el =>
			el.classList.contains('cbi-section') ||
			(el.classList.contains('cbi-value') && el.querySelector('h4, table')));

		if (blocks.length < 2) return;

		outer.classList.add('td-section-stack');

		for (const block of blocks) {
			block.classList.add('td-subcard');

			const sid = (block.id.match(/(__[A-Za-z0-9_]+__)$/) || [])[1];
			const label = sid && titles[sid];

			if (label && !block.querySelector(':scope > h3, :scope > h4, :scope > legend')) {
				const head = document.createElement('h3');
				head.textContent = label;
				block.insertBefore(head, block.firstChild);
			}
		}
	},

	collapseSectionHelp(root) {
		for (const descr of root.querySelectorAll('.cbi-section-descr')) {
			if (descr.closest('.modal') || descr.closest('.td-desc') || descr.dataset.tdCollapsed)
				continue;

			if (descr.textContent.trim().length <= 160)
				continue;

			const details = document.createElement('details');
			const summary = document.createElement('summary');

			details.className = 'td-desc';
			summary.textContent = T('说明', 'Details');
			descr.dataset.tdCollapsed = '1';
			descr.parentNode.insertBefore(details, descr);
			details.appendChild(summary);
			details.appendChild(descr);
		}
	},

	/* The indicator sits at the top-right of the content area: level with the page tabs when the
	 * page has them, otherwise level with the page title. Alerts and async views move that anchor,
	 * so measure it instead of hard-coding an offset. */
	bindIndicators() {
		const main = document.getElementById('maincontent');
		if (!main) return;

		let raf = 0;
		const schedule = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => this.positionIndicators());
		};

		window.addEventListener('resize', schedule);
		new MutationObserver(schedule).observe(main, { childList: true, characterData: true, subtree: true });

		if ('ResizeObserver' in window) {
			const ro = new ResizeObserver(schedule);
			[ 'indicators', 'view', 'tabmenu' ].forEach(id => {
				const el = document.getElementById(id);
				if (el) ro.observe(el);
			});
		}

		schedule();
		setTimeout(schedule, 500);
	},

	positionIndicators() {
		const top = document.querySelector('.td-top');
		const box = document.getElementById('maincontent');
		const ind = document.getElementById('indicators');
		if (!top || !box || !ind) return;

		const clearHead = () => {
			if (this._indHead) { this._indHead.style.paddingRight = ''; this._indHead = null; }
		};

		if (mqPhone.matches) {
			top.style.removeProperty('top');
			top.style.removeProperty('right');
			clearHead();
			return;
		}

		const shown = el => el && el.getClientRects().length > 0;
		const tabs = document.querySelector('#tabmenu .tabs');
		const view = document.getElementById('view');
		let ref = shown(tabs) ? tabs : null;
		let align = 'center';

		if (!ref)
			for (const h of document.querySelectorAll('#view h1, #view h2')) {
				if (shown(h)) { ref = h; break; }
			}

		if (!ref && shown(view)) {
			ref = view;
			align = 'top';
		}

		if (!ref) {
			top.style.top = '0px';
			top.style.removeProperty('right');
			clearHead();
			return;
		}

		/* Home and Devices put an action button on the title row. Keep the indicators on the same
		 * line and immediately left of it: .td-head aligns the button to the bottom of the text
		 * block, so aligning with the h1 left the two on different baselines. */
		const head = ref.closest('.td-head');
		const action = head && head.querySelector(':scope > a, :scope > button, :scope > .btn');

		if (action && ind.offsetWidth) {
			clearHead();

			const gap = 16;
			const b = box.getBoundingClientRect(), a = action.getBoundingClientRect();
			top.style.right = Math.max(0, Math.round(b.right - a.left + gap)) + 'px';

			let measured = 0, node = action;
			while (node && node != box) { measured += node.offsetTop; node = node.offsetParent; }

			let y;
			if (node == box)
				y = measured + (action.offsetHeight - ind.offsetHeight) / 2;
			else {
				const r = action.getBoundingClientRect();
				y = r.top - b.top + (r.height - ind.offsetHeight) / 2;
			}

			top.style.top = Math.max(0, Math.round(y)) + 'px';
			return;
		}

		clearHead();
		top.style.removeProperty('right');

		/* Layout offsets ignore the view's entrance transform, so the indicator does not settle
		 * 6px low when it is measured while #view is still animating. */
		let measured = 0, node = ref;
		while (node && node != box) { measured += node.offsetTop; node = node.offsetParent; }

		let y;
		if (node == box)
			y = measured + (align == 'top' ? 0 : (ref.offsetHeight - ind.offsetHeight) / 2);
		else {
			const b = box.getBoundingClientRect();
			const r = ref.getBoundingClientRect();
			y = r.top - b.top + (align == 'top' ? 0 : (r.height - ind.offsetHeight) / 2);
		}

		top.style.top = Math.max(0, Math.round(y)) + 'px';
	},

	render(tree) {
		const pages = td.flatten(tree);
		const groups = td.grouped(pages);
		const here = L.env.dispatchpath.join('/');
		let current = null;

		pages.forEach(p => {
			if ((here == p.path || here.indexOf(p.path + '/') == 0) && (!current || p.path.length > current.path.length))
				current = p;
		});

		this.pages = pages;
		this.groups = groups;
		this.current = current;

		this.renderNav(groups, current);
		this.renderPills(groups, current);

		if (current)
			this.renderTabs(current.node, current.path, current.path.split('/').length);

		const btn = document.getElementById('td-search');
		if (btn) btn.addEventListener('click', () => this.openSearch());
	},

	href(group) {
		/* The apps overview duplicates the sidebar on desktop, and landing there selects nothing.
		 * Enter the first app instead; phones have no sidebar and keep the overview. */
		const list = (group.id == 'apps' && !mqPhone.matches)
			? group.list.filter(p => p.path != 'admin/apps')
			: group.list;
		return L.url((list[0] || group.list[0]).path);
	},

	renderNav(groups, current) {
		const nav = document.getElementById('td-nav');
		if (!nav) return;

		nav.innerHTML = groups.map((g, i) => {
			const on = current && current.group == g.id;
			const short = g.short ? `<span class="lbl has-short">${esc(g.label)}</span><span class="short">${esc(g.short)}</span>`
			                      : `<span class="lbl">${esc(g.label)}</span>`;
			return `<a href="${this.href(g)}" data-g="${g.id}" title="${esc(g.label)}" class="${on ? 'on' : ''}${g.mob === false ? ' mob-hide' : ''}" style="animation-delay:${i * 25}ms">${icon(g.icon)}${short}</a>`;
		}).join('');

		const sys = nav.querySelector('[data-g="system"]');
		if (sys)
			sys.addEventListener('click', ev => {
				if (!mqPhone.matches) return;
				ev.preventDefault();
				this.openSheet();
			});
	},

	renderPills(groups, current) {
		const box = document.getElementById('td-pills');
		if (!box || !current) return;

		const g = groups.find(x => x.id == current.group);
		/* The apps overview is the group's landing page in the top bar, so repeating "All apps"
		 * in the sidebar is noise. Phones keep it because the group is absent from the bottom bar. */
		const items = (current.group == 'apps' && !mqPhone.matches)
			? g.list.filter(p => p.path != 'admin/apps')
			: g.list;

		if (items.length < 2) return;

		box.innerHTML = items.map(p => `<a href="${L.url(p.path)}" class="${p === current ? 'on' : ''}">${esc(p.title)}</a>`).join('');
		const on = box.querySelector('.on');
		if (on && on.scrollIntoView) box.scrollLeft = Math.max(0, on.offsetLeft - 40);

		const edge = () => {
			box.classList.toggle('scrolls', box.scrollWidth > box.clientWidth + 2);
			box.classList.toggle('end', box.scrollLeft + box.clientWidth >= box.scrollWidth - 2);
		};
		box.addEventListener('scroll', edge, { passive: true });
		window.addEventListener('resize', edge);
		edge();
	},

	renderTabs(node, url, level) {
		const container = document.getElementById('tabmenu');
		const children = ui.menu.getChildren(node);

		if (!container || !children.length) return;

		const ul = E('ul', { 'class': 'tabs' });
		let active = null;

		children.forEach(child => {
			const isActive = (L.env.dispatchpath[level] == child.name);
			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s%s'.format(child.name, isActive ? ' active' : '') }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));
			if (isActive) active = child;
		});

		container.appendChild(ul);
		container.style.display = '';

		if (active)
			this.renderTabs(td.realNode(node, active), url + '/' + active.name, level + 1);
	},

	/* ---------- search (⌘K) ---------- */

	entries() {
		if (this._entries) return this._entries;
		const out = [];
		(this.groups || []).forEach(g => g.list.forEach(p => {
			out.push({ path: p.path, title: p.title, group: g.label, icon: g.icon, en: p.node.title || '' });
			ui.menu.getChildren(p.node).forEach(c => out.push({
				path: p.path + '/' + c.name, title: p.title + ' · ' + _(c.title), group: g.label, icon: g.icon, en: c.title || ''
			}));
		}));
		return (this._entries = out);
	},

	openSearch() {
		if (document.querySelector('.td-pop:not(.td-out)')) return;

		const pop = td.html(`<div class="td-pop" role="dialog" aria-modal="true">
			<div class="td-pop-box">
				<label class="td-pop-in">${icon('search')}<input type="search" placeholder="${esc(T('搜索功能或设置，例如“端口转发”', 'Search pages and settings'))}" autocomplete="off"><kbd>Esc</kbd></label>
				<div class="td-pop-list"></div>
			</div></div>`);
		document.body.appendChild(pop);

		const input = pop.querySelector('input'), list = pop.querySelector('.td-pop-list');
		const all = this.entries();
		let sel = 0, shown = [];

		const draw = () => {
			const q = input.value.trim().toLowerCase();
			shown = !q ? all.filter(e => e.path.split('/').length <= 3).slice(0, 40)
			           : all.filter(e => (e.title + ' ' + e.en + ' ' + e.group + ' ' + e.path).toLowerCase().indexOf(q) > -1).slice(0, 40);
			sel = Math.min(sel, Math.max(0, shown.length - 1));
			list.innerHTML = shown.length ? shown.map((e, i) =>
				`<a href="${L.url(e.path)}" class="${i == sel ? 'on' : ''}" data-i="${i}">${icon(e.icon)}<span>${esc(e.title)}</span><small>${esc(e.group)}</small></a>`).join('')
				: `<div class="td-pop-empty">${esc(T('没有找到相关功能', 'Nothing found'))}</div>`;
			const on = list.querySelector('.on');
			if (on) on.scrollIntoView({ block: 'nearest' });
		};

		const close = () => td.leave(pop);

		input.addEventListener('input', () => { sel = 0; draw() });
		input.addEventListener('keydown', ev => {
			if (ev.key == 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); ev.preventDefault() }
			else if (ev.key == 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); ev.preventDefault() }
			else if (ev.key == 'Enter' && shown[sel]) { location.href = L.url(shown[sel].path) }
			else if (ev.key == 'Escape') close();
		});
		list.addEventListener('mousemove', ev => {
			const a = ev.target.closest('a[data-i]');
			if (a && +a.dataset.i != sel) { sel = +a.dataset.i; list.querySelectorAll('a').forEach(x => x.classList.toggle('on', x === a)) }
		});
		pop.addEventListener('click', ev => { if (ev.target === pop) close() });

		draw();
		input.focus();
	},

	/* ---------- phone: "More" sheet ---------- */

	openSheet() {
		if (document.querySelector('.td-pop:not(.td-out)')) return;

		const rest = (this.groups || []).filter(g => g.mob === false || g.id == 'system');
		const body = rest.map(g => `<div class="grp">${esc(g.label)}</div>` +
			g.list.map(p => `<a href="${L.url(p.path)}" class="${this.current === p ? 'on' : ''}">${icon(g.id == 'apps' ? td.appIcon(p.path) : g.icon)}<span>${esc(p.title)}</span></a>`).join('')).join('');

		const pop = td.html(`<div class="td-pop" role="dialog" aria-modal="true"><div class="td-pop-box">
			<div class="td-pop-list">${body}</div>
			<div class="td-sheet-tools">
				<button class="btn" type="button" data-act="search">${icon('search')}${esc(T('搜索', 'Search'))}</button>
				<button class="btn" type="button" data-act="mode">${icon('moon')}${esc(T('深浅色', 'Theme'))}</button>
				<a class="btn" href="${L.url('admin/logout')}">${icon('logout')}${esc(T('退出', 'Log out'))}</a>
			</div></div></div>`);

		document.body.appendChild(pop);
		pop.addEventListener('click', ev => {
			const b = ev.target.closest('[data-act]');
			if (ev.target === pop) td.leave(pop);
			else if (b && b.dataset.act == 'search') { pop.remove(); this.openSearch() }
			else if (b && b.dataset.act == 'mode') this.toggleMode();
		});
	},

	/* ---------- keyboard & dark mode ---------- */

	bindKeys() {
		const kbd = document.querySelector('.td-search kbd');
		if (kbd && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) kbd.textContent = 'Ctrl K';

		document.addEventListener('keydown', ev => {
			const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || '') || (ev.target || {}).isContentEditable;
			if ((ev.key == 'k' || ev.key == 'K') && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); this.openSearch() }
			else if (ev.key == '/' && !typing && !document.body.classList.contains('modal-overlay-active')) { ev.preventDefault(); this.openSearch() }
		});
	},

	bindMode() {
		const btn = document.getElementById('td-mode');
		const sync = () => {
			if (!btn) return;
			const dark = document.documentElement.getAttribute('data-theme') == 'dark';
			btn.innerHTML = icon(dark ? 'sun' : 'moon');
			btn.title = dark ? T('切换到浅色', 'Light mode') : T('切换到深色', 'Dark mode');
		};

		if (btn) btn.addEventListener('click', () => this.toggleMode());
		document.addEventListener('td-look', sync);
		matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (document.documentElement.getAttribute('data-mode') == 'auto')
				td.applyLook({ palette: document.documentElement.getAttribute('data-palette'), mode: 'auto' });
		});
		sync();
	},

	toggleMode() {
		const r = document.documentElement;
		const mode = r.getAttribute('data-theme') == 'dark' ? 'light' : 'dark';
		td.applyLook({ palette: r.getAttribute('data-palette') || 'clay', mode: mode });
		td.saveSettings({ mode: mode }).catch(() => {});
	}
});
