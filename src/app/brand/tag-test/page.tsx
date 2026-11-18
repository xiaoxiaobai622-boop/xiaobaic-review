import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

const TEMPLATE = '<style>.b{display:block;width:100%;height:54px;background:#07C160;color:#fff;font-size:16px;border:0}</style><button class="b">'

const TAG_A1 = `<wx-open-launch-weapp id="t1" appid="wxcbdd1a599d18af2b" username="gh_d8e227bc50e3" path="pages/share/index?code=9zy8p7tb"><script type="text/wxtag-template">${TEMPLATE}打开小程序（A1）</button></script></wx-open-launch-weapp>`

const TAG_A2 = `<wx-open-launch-weapp id="t2" appid="wxcbdd1a599d18af2b" username="gh_d8e227bc50e3" path="pages/share/index?code=9zy8p7tb" style="display:block;width:100%;height:54px"><script type="text/wxtag-template">${TEMPLATE}打开小程序（A2）</button></script></wx-open-launch-weapp>`

const SCRIPT = `
(function () {
  function rep(stage, detail) {
    fetch('/api/wechat/js-sdk/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage: stage, detail: 'tagtest ' + detail, page: location.pathname }),
      keepalive: true,
    }).catch(function () {});
  }
  function set(msg) {
    var el = document.getElementById('log');
    if (el) el.textContent += '\\n' + msg;
  }
  function measure(id) {
    var el = document.getElementById(id);
    if (!el) return id + ':missing';
    return id + ':h=' + Math.round(el.getBoundingClientRect().height) + (el.shadowRoot ? ' shadow' : ' noshadow');
  }
  document.addEventListener('WeixinOpenTagsError', function (e) {
    set('openTagsError=' + (e.detail && e.detail.errMsg));
    rep('open-tags-error', 'test ' + (e.detail && e.detail.errMsg));
  });
  document.addEventListener('securitypolicyviolation', function (e) {
    set('CSP blocked ' + e.violatedDirective + ' ' + e.blockedURI);
    rep('config-error', 'csp ' + e.violatedDirective + ' ' + e.blockedURI);
  });
  rep('page-load', 'tagtest-nocsp page loaded');
  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('load fail')); };
      document.head.appendChild(s);
    });
  }
  load('https://res.wx.qq.com/open/js/jweixin-1.6.0.js')
    .then(function () {
      return fetch('/api/wechat/js-sdk?url=' + encodeURIComponent(location.href.split('#')[0])).then(function (r) { return r.json(); });
    })
    .then(function (sign) {
      wx.config({
        debug: false,
        appId: sign.appId,
        timestamp: sign.timestamp,
        nonceStr: sign.nonceStr,
        signature: sign.signature,
        jsApiList: [],
        openTagList: ['wx-open-launch-weapp'],
      });
      wx.ready(function () {
        set('config ok');
        setTimeout(function () {
          var state = measure('t1') + ' | ' + measure('t2');
          set(state);
          rep('tag-state', 'test ' + state);
        }, 1500);
      });
      wx.error(function (r) {
        set('config error ' + (r && r.errMsg));
        rep('config-error', 'test ' + (r && r.errMsg));
      });
    })
    .catch(function (e) {
      set('js fail ' + e.message);
      rep('config-error', 'test js fail ' + e.message);
    });
})();
`

export default async function TagTestPage() {
  const nonce = (await headers()).get('x-nonce') || undefined
  return (
    <main style={{ padding: 20, fontFamily: 'sans-serif', background: '#0b0b0d', color: '#f5f5f7', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18 }}>开放标签测试（无 CSP）</h1>
      <p style={{ color: '#8e8e93', fontSize: 13 }}>A1 官方最小写法 / A2 显式高度</p>

      <div style={{ marginTop: 20, fontSize: 13 }}>A1</div>
      <div dangerouslySetInnerHTML={{ __html: TAG_A1 }} />

      <div style={{ marginTop: 24, fontSize: 13 }}>A2</div>
      <div dangerouslySetInnerHTML={{ __html: TAG_A2 }} />

      <pre id="log" style={{ marginTop: 24, whiteSpace: 'pre-wrap', fontSize: 12, color: '#8e8e93' }}>waiting</pre>

      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </main>
  )
}
