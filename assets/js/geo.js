/**
 * Public IP + city/country detection (same idea as 2ip).
 * Runs on page load so registration already has the address.
 */
(function (w) {
  'use strict';

  function isPublicIp(ip) {
    ip = String(ip || '').trim();
    if (!ip) return false;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === 'localhost') return false;
    if (ip.indexOf('10.') === 0 || ip.indexOf('192.168.') === 0 || ip.indexOf('169.254.') === 0) return false;
    var m = ip.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || (ip.indexOf(':') !== -1);
  }

  function save(info) {
    if (!info || !isPublicIp(info.ip)) return info;
    w.__sgGeo = info;
    try {
      localStorage.setItem('sg_pub_ip', info.ip);
      localStorage.setItem('sg_pub_geo', JSON.stringify(info));
    } catch (e) {}
    return info;
  }

  function parseCfTrace(text) {
    var ip = '';
    String(text || '').split('\n').forEach(function (line) {
      if (line.indexOf('ip=') === 0) ip = line.slice(3).trim();
    });
    return ip;
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); });
  }

  function getText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.text(); });
  }

  var pending = null;

  function detect() {
    if (w.__sgGeo && isPublicIp(w.__sgGeo.ip) && w.__sgGeo.city && w.__sgGeo.country) {
      return Promise.resolve(w.__sgGeo);
    }
    if (pending) return pending;

    // Prefer providers that return IP + city + country together.
    // IP-only providers are kept as a final fallback.
    var tasks = [
      // Geo providers: all are public HTTPS APIs; no API key is required.
      getJson('https://ipwho.is/').then(function (d) {
        return { ip: d && d.ip, city: d && d.city || '', country: d && d.country || '' };
      }),
      getJson('https://ipapi.co/json/').then(function (d) {
        return { ip: d && d.ip, city: d && d.city || '', country: d && (d.country_name || d.country) || '' };
      }),
      getJson('https://get.geojs.io/v1/ip/geo.json').then(function (d) {
        return { ip: d && d.ip, city: d && d.city || '', country: d && d.country || '' };
      }),
      getJson('https://ipinfo.io/json').then(function (d) {
        return { ip: d && d.ip, city: d && d.city || '', country: d && d.country || '' };
      }),
      getJson('https://api.bigdatacloud.net/data/ip-geolocation?localityLanguage=en').then(function (d) {
        return {
          ip: d && d.ip,
          city: d && (d.city || (d.localityInfo && d.localityInfo.administrative && d.localityInfo.administrative[3] && d.localityInfo.administrative[3].name)) || '',
          country: d && d.country && (d.country.name || d.country.isoName) || ''
        };
      }),
      getJson('https://api.ipify.org?format=json').then(function (d) {
        return { ip: d && d.ip, city: '', country: '' };
      }),
      getJson('https://api64.ipify.org?format=json').then(function (d) {
        return { ip: d && d.ip, city: '', country: '' };
      }),
      getText('https://www.cloudflare.com/cdn-cgi/trace').then(function (t) {
        return { ip: parseCfTrace(t), city: '', country: '' };
      }),
      getText('https://ipv4.icanhazip.com').then(function (t) {
        return { ip: String(t || '').trim(), city: '', country: '' };
      })
    ];

    pending = new Promise(function (resolve) {
      var results = [];
      var left = tasks.length;
      var done = false;

      tasks.forEach(function (p) {
        p.then(function (info) {
          if (done) return;
          if (info && isPublicIp(info.ip)) {
            results.push(info);
            // Do not stop on an IP-only or country-only response. Wait for a
            // provider that gives BOTH city and country when possible.
            if (info.city && info.country) {
              done = true;
              resolve(save(info));
              return;
            }
          }
          left--;
          if (left <= 0) {
            done = true;
            var ipOnly = results.find(function (x) { return isPublicIp(x.ip); });
            resolve(save(ipOnly || { ip: '', city: '', country: '' }));
          }
        }).catch(function () {
          left--;
          if (!done && left <= 0) {
            done = true;
            var ipOnly = results.find(function (x) { return isPublicIp(x.ip); });
            resolve(save(ipOnly || { ip: '', city: '', country: '' }));
          }
        });
      });
    });

    return pending;
  }


  w.SGGeo = {
    detect: detect,
    isPublicIp: isPublicIp,
    current: function () {
      if (w.__sgGeo && isPublicIp(w.__sgGeo.ip)) return w.__sgGeo;
      try {
        var ip = localStorage.getItem('sg_pub_ip') || '';
        if (isPublicIp(ip)) return { ip: ip, city: '', country: '' };
      } catch (e) {}
      return { ip: '', city: '', country: '' };
    }
  };

  detect();
})(window);
