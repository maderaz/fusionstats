// routes.js — where a deposit came from.
//
// One definition of deposit attribution, shared by every page that shows it.
// It used to live inline in /stocks, and the bugs it has had — Harvest filed
// under Direct, LI.FI named from a counterparty tooltip, four identical
// "Harvest" rows — were each found and fixed there. A second copy on another
// page would have had to re-find every one of them. So the rules live here and
// the pages only decide which events to feed in and how to draw the result.
//
//   const R = FusionRoutes.create({ identity, events });
//   R.depositRoute(e)      -> the row a deposit belongs on
//   R.routeInfo(route)     -> how to label that row, and why
//   R.totals(deposits)     -> gross in per route
//   R.originOfValue(holdings, deposits) -> what is still here, per route
//
// `identity` is router-identity.json as fetched (its _meta is lifted out).
// `events` is whatever the page has loaded: it is only used to learn which
// owners each contract has deposited for, which is what separates a personal
// smart account from a protocol router.
(function () {
  'use strict';

  const DIRECT = 'direct';
  // Named contracts collapse onto their protocol; this marks such a key so it
  // can never collide with a contract address.
  const PROTO = 'p:';

  // IPOR is not a route into Fusion — IPOR *is* Fusion. Its ReferralPlasmaVault
  // and zap contracts are the app's own deposit path, so listing them beside
  // Harvest and Portals reads as a third party when it is the front door.
  const DISPLAY_NAME = { IPOR: 'Direct Zap' };
  const displayName = (p) => DISPLAY_NAME[p] || p;

  const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
  const lc = (a) => (a || '').toLowerCase();

  function create(opts) {
    const raw = (opts && opts.identity) || {};
    // _meta records how far the identification sweep reached. It is not an
    // address, so lift it out before anything looks a route up in here.
    const coverage = raw._meta || {};
    const identity = {};
    Object.keys(raw).forEach(k => { if (k !== '_meta') identity[k] = raw[k]; });

    // Which owners each depositing contract has ever deposited for. Built once
    // from the events, because it is what tells a personal smart account apart
    // from a protocol router: an account deposits only for itself and for the
    // address that deployed it.
    const contractOwners = {};
    ((opts && opts.events) || []).forEach(e => {
      if (e.type !== 'deposit') return;
      const sender = lc(e.sender), owner = lc(e.owner);
      if (!sender || !owner) return;
      (contractOwners[sender] = contractOwners[sender] || new Set()).add(owner);
    });

    const knownProtocol = (addr) => {
      const id = identity[addr];
      return id && id.protocol ? id : null;
    };

    // An unverified contract whose deployer is one of the addresses it deposits
    // for is that person's own wallet contract, not a route anyone else can
    // take. Saying so is worth more than showing them eight hex characters.
    function smartAccount(addr) {
      const id = identity[addr];
      if (!id || id.protocol || !id.creatorAddress) return null;
      const owners = contractOwners[addr];
      if (!owners || !owners.has(id.creatorAddress)) return null;
      return { owner: id.creatorAddress, interactsWith: id.interactsWith || [] };
    }

    // Where a deposit came from. Two shapes, and only one of them is obvious.
    //
    //   sender != owner   A contract pushed the deposit on someone else's
    //                     behalf — a zap, an aggregator, a referral wrapper.
    //                     The sender is the route.
    //   sender == owner   Usually a wallet depositing for itself. But it is
    //                     also what an autocompounder looks like: Harvest's
    //                     strategy holds the Fusion position on behalf of
    //                     Harvest's own depositors, and deposits under its own
    //                     address. Reading only the first shape filed the
    //                     single largest source of stock-vault deposits under
    //                     "Direct". So when the owner is itself a known
    //                     protocol contract, that protocol is the route.
    function depositContract(e) {
      const sender = lc(e.sender), owner = lc(e.owner);
      if (!sender || !owner) return DIRECT;
      if (sender !== owner) return sender;
      return knownProtocol(owner) ? owner : DIRECT;
    }

    // …and the row it belongs on. A protocol usually runs more than one
    // contract: Harvest deploys one strategy per ticker, so attributing by
    // contract put four rows reading "Harvest" next to each other, identical
    // and unrankable. The question is which PROTOCOL people came through, so
    // named contracts collapse onto their protocol and unidentified ones stay
    // separate — merging those would be inventing a relationship we have no
    // evidence for.
    function depositRoute(e) {
      const c = depositContract(e);
      if (c === DIRECT) return DIRECT;
      const id = knownProtocol(c);
      return id ? PROTO + id.protocol : c;
    }

    // Names only where a name is established; everything else keeps its
    // address, because "Other" hides exactly the thing worth finding out.
    // Each identity entry records HOW it was named, and that is kept apart:
    //   via 'source'    the protocol's fingerprints are in the contract's own
    //                   verified source — its words about itself;
    //   via 'deployer'  the contract is a bare proxy that says nothing, and the
    //                   name comes from Basescan's attribution of who deployed
    //                   it. Good evidence, but not the contract's own.
    function routeInfo(route) {
      if (route === DIRECT) return { protocol: 'Direct', detail: 'straight into the vault', named: true, kind: 'direct' };
      if (route.startsWith(PROTO)) {
        const name = route.slice(PROTO.length);
        // Every checked contract carrying this name, so the row can say how
        // many there are and how each of them was established.
        const mine = Object.values(identity).filter(v => v && v.protocol === name);
        const via = mine.every(v => v.via === 'source') ? 'source'
                  : mine.every(v => v.via === 'deployer') ? 'deployer' : 'mixed';
        return { protocol: displayName(name), rawProtocol: name, named: true, kind: 'protocol', via,
                 // The detail column describes a single contract. When a row
                 // stands for several, the row itself says how many it saw —
                 // a count taken from the events on screen, not the whole file.
                 detail: via === 'deployer' ? 'proxy, deployed by ' + name
                                            : (mine[0] && (mine[0].contractNames || [])[0]) || '',
                 reason: (mine[0] || {}).reason, evidence: (mine[0] || {}).evidence };
      }
      const acct = smartAccount(route);
      if (acct) {
        return { protocol: 'Smart account', named: true, kind: 'account', via: 'creator',
                 // A legend is one narrow line and ellipsises anything longer,
                 // which ate the "· LI.FI" when the address came first. The
                 // address is in the table; the protocol is the part worth the
                 // width, so it wins the tiebreak.
                 pieLabel: 'Smart account · '
                   + (acct.interactsWith.length ? acct.interactsWith.join(', ') : shortAddr(acct.owner)),
                 detail: 'own contract of ' + shortAddr(acct.owner)
                   + (acct.interactsWith.length ? ' · funds arrive via ' + acct.interactsWith.join(', ') : ''),
                 reason: 'deployed by ' + acct.owner + ', which is one of the addresses it deposits for'
                   + (acct.interactsWith.length
                       ? '. Its transactions go through ' + acct.interactsWith.join(', ')
                         + ' — that is who it trades with, not what it is.' : '') };
      }
      const id = identity[route];
      return { protocol: shortAddr(route), named: false, kind: 'unknown', contracts: 1,
               detail: id ? (id.verified ? 'verified, no known fingerprint' : 'source not verified') : 'not yet checked',
               reason: id ? id.reason : 'not yet checked' };
    }

    // Gross inflow per route — "how people got in", including money that has
    // since left again. Takes deposits the page has already scoped (to a range,
    // to a set of vaults); the rule is the same whatever the scope.
    function totals(deposits) {
      const by = {};
      deposits.forEach(e => {
        if (e.type !== 'deposit') return;
        const r = depositRoute(e), c = depositContract(e);
        const t = by[r] || (by[r] = { route: r, usd: 0, n: 0, wallets: new Set(),
                                      contracts: new Set(), selfOwned: false });
        t.usd += e.usdValue || 0; t.n++;
        t.contracts.add(c);
        const w = lc(e.owner); if (w) t.wallets.add(w);
        // The protocol deposited under its own address, so the "wallets" on
        // this route are its own contracts, not people. Compare against the
        // contract, not the row it was grouped onto.
        if (r !== DIRECT && w === c) t.selfOwned = true;
      });
      return Object.values(by)
        .map(t => ({ ...t, wallets: t.wallets.size, contracts: t.contracts.size }))
        .sort((a, b) => b.usd - a.usd);
    }

    // What is still here, split by the route it came in through. Each holder's
    // current value is divided across routes in proportion to what that holder
    // deposited through each one — the only attribution the data supports, as
    // shares carry no memory of the path that minted them. A holder with no
    // deposit on record arrived by transfer and is reported as unattributed
    // rather than guessed at.
    function originOfValue(holdings, deposits) {
      const grossByWallet = {};
      deposits.forEach(e => {
        if (e.type !== 'deposit') return;
        const w = lc(e.owner); if (!w) return;
        const r = depositRoute(e);
        (grossByWallet[w] = grossByWallet[w] || {})[r] = (grossByWallet[w][r] || 0) + (e.usdValue || 0);
      });
      const out = {};
      let unattributed = 0;
      holdings.forEach(h => {
        const mix = grossByWallet[h.wallet];
        if (!mix) { unattributed += h.usd; return; }
        const total = Object.values(mix).reduce((a, b) => a + b, 0);
        if (total <= 0) { unattributed += h.usd; return; }
        Object.entries(mix).forEach(([route, usd]) => {
          out[route] = (out[route] || 0) + h.usd * (usd / total);
        });
      });
      const list = Object.entries(out).map(([route, usd]) => ({ route, usd }))
        .sort((a, b) => b.usd - a.usd);
      return { list, unattributed, total: list.reduce((a, b) => a + b.usd, 0) + unattributed };
    }

    // Each owner's deposits, split by the route they came through, as
    // fractions. What an exit is charged against.
    function ownerMix(deposits) {
      const by = {};
      deposits.forEach(e => {
        if (e.type !== 'deposit') return;
        const w = lc(e.owner); if (!w) return;
        const r = depositRoute(e);
        const m = by[w] || (by[w] = { usd: {}, n: {} });
        m.usd[r] = (m.usd[r] || 0) + (e.usdValue || 0);
        m.n[r] = (m.n[r] || 0) + 1;
      });
      const out = {};
      Object.entries(by).forEach(([w, m]) => {
        // Weighted by value; by count only if every deposit was unpriced.
        const src = Object.values(m.usd).some(v => v > 0) ? m.usd : m.n;
        const tot = Object.values(src).reduce((a, b) => a + b, 0);
        out[w] = {};
        Object.entries(src).forEach(([r, v]) => { out[w][r] = v / tot; });
      });
      return out;
    }

    // Whose money an exit is. The owner's own deposit history first. Failing
    // that, a protocol contract acting as itself: Zyfi's adapter deposits FOR
    // users but withdraws AS itself, after pulling their shares, so its exits
    // carry an owner with no deposit here at all. Filing those as
    // unattributed split Zyfi's rebalancing in two — every dollar in on the
    // Zyfi row, every dollar out somewhere else — and overstated Zyfi's net by
    // $850K over thirty days on the Base USDC Lending Optimizer. The same test
    // the deposit side uses: when the owner, or the contract that pushed the
    // exit, is a known protocol, that protocol is the route.
    function exitMix(mix, owner, sender) {
      if (mix[owner]) return mix[owner];
      const byOwner = knownProtocol(owner);
      if (byOwner) return { [PROTO + byOwner.protocol]: 1 };
      const bySender = sender && sender !== owner ? knownProtocol(sender) : null;
      if (bySender) return { [PROTO + bySender.protocol]: 1 };
      return null;
    }

    // In, out and net per route.
    //
    // Gross in on its own badly misleads wherever a protocol rebalances:
    // Harvest's strategy and Zyfi's adapter both deposit and withdraw in the
    // same transaction, so their gross runs to many times what they actually
    // add. Net is what answers "who brought money that stayed".
    //
    // Deposits count where they came in. Exits are charged to the route their
    // OWNER came in through, split across that owner's deposit history — a
    // wallet that entered through Zyfi and left directly is Zyfi money
    // leaving, and charging the exit to Direct would overstate Zyfi and
    // understate Direct by the same amount. `mixDeposits` is the history that
    // split is read from, and is usually wider than the window: an exit this
    // week can belong to a deposit made in August. An owner with no deposit on
    // record who is not a protocol either received shares by transfer; their
    // exits are unattributed.
    function flows(opts) {
      const deposits = opts.deposits || [], withdrawals = opts.withdrawals || [];
      const history = opts.mixDeposits || deposits;
      const mix = ownerMix(history);
      // Custody is a property of the route, not of the window: read it from the
      // whole history so a route with only exits on screen still reports it.
      const custodial = new Set(totals(history).filter(t => t.selfOwned).map(t => t.route));
      const rows = {};
      const row = (route) => rows[route] || (rows[route] = {
        route, in: 0, out: 0, n: 0, exits: 0, wallets: 0, contracts: 0, selfOwned: custodial.has(route) });
      totals(deposits).forEach(t => {
        Object.assign(row(t.route), { in: t.usd, n: t.n, wallets: t.wallets, contracts: t.contracts });
      });
      let unattributedOut = 0;
      withdrawals.forEach(e => {
        if (e.type === 'deposit') return;
        const usd = e.usdValue || 0;
        const m = exitMix(mix, lc(e.owner), lc(e.sender));
        if (!m) { unattributedOut += usd; return; }
        Object.entries(m).forEach(([route, f]) => { const r = row(route); r.out += usd * f; r.exits += f; });
      });
      const list = Object.values(rows).map(r => ({ ...r, net: r.in - r.out }))
        .sort((a, b) => b.net - a.net);
      const tin = list.reduce((a, r) => a + r.in, 0);
      const tout = list.reduce((a, r) => a + r.out, 0) + unattributedOut;
      return { list, unattributedOut, in: tin, out: tout, net: tin - tout };
    }

    // The same net, per time bucket, for a chart of who drove each wave.
    // `bucketOf(ts)` returns the bucket's start; routes come back ordered by
    // their total net so the stack reads the same way as the table.
    function netSeries(opts) {
      const mix = ownerMix(opts.mixDeposits || opts.deposits || []);
      const cells = {}, buckets = new Set(), routeNet = {};
      const add = (b, route, v) => {
        buckets.add(b);
        const k = route + '|' + b;
        cells[k] = (cells[k] || 0) + v;
        routeNet[route] = (routeNet[route] || 0) + v;
      };
      (opts.deposits || []).forEach(e => {
        if (e.type !== 'deposit' || !e.timestamp) return;
        add(opts.bucketOf(e.timestamp), depositRoute(e), e.usdValue || 0);
      });
      (opts.withdrawals || []).forEach(e => {
        if (e.type === 'deposit' || !e.timestamp) return;
        const b = opts.bucketOf(e.timestamp), usd = e.usdValue || 0, m = exitMix(mix, lc(e.owner), lc(e.sender));
        if (!m) { add(b, '__unattributed__', -usd); return; }
        Object.entries(m).forEach(([route, f]) => add(b, route, -usd * f));
      });
      const bs = [...buckets].sort((a, b) => a - b);
      const routes = Object.keys(routeNet).sort((a, b) => routeNet[b] - routeNet[a]);
      const net = {};
      routes.forEach(r => { net[r] = bs.map(b => cells[r + '|' + b] || 0); });
      return { buckets: bs, routes, net, routeNet };
    }

    // Owners ranked by what they added over the window, net of what they took
    // out, with the route most of their deposits came through. A wave is often
    // one wallet, and a route total cannot show that.
    function topNet(opts) {
      const mix = ownerMix(opts.mixDeposits || opts.deposits || []);
      const by = {};
      const acc = (w) => by[w] || (by[w] = { wallet: w, in: 0, out: 0, n: 0 });
      (opts.deposits || []).forEach(e => {
        if (e.type !== 'deposit') return;
        const w = lc(e.owner); if (!w) return;
        const a = acc(w); a.in += e.usdValue || 0; a.n++;
      });
      (opts.withdrawals || []).forEach(e => {
        if (e.type === 'deposit') return;
        const w = lc(e.owner); if (!w) return;
        acc(w).out += e.usdValue || 0;
      });
      return Object.values(by).map(a => {
        const m = exitMix(mix, a.wallet, null) || {};
        const route = Object.keys(m).sort((x, y) => m[y] - m[x])[0] || null;
        return { ...a, net: a.in - a.out, route };
      }).sort((a, b) => b.net - a.net).slice(0, opts.limit || 5);
    }

    return { DIRECT, PROTO, identity, coverage, knownProtocol, smartAccount,
             depositContract, depositRoute, routeInfo, totals, originOfValue,
             ownerMix, flows, netSeries, topNet };
  }

  window.FusionRoutes = { create, DIRECT, PROTO, DISPLAY_NAME, displayName, shortAddr };
})();
