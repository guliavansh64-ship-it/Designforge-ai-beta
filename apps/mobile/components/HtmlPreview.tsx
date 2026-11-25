import { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useColors } from '../lib/theme';
import { Animated, Skeleton } from './motion';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * Preview of GENERATED HTML only (the app itself is native).
 * Hardening:
 *  - baseUrl about:blank, no file/content access, no third-party cookies/DOM storage
 *  - CSP meta: connect-src 'none' (no exfiltration), only Tailwind CDN + Google Fonts + https images
 *  - every navigation attempt is blocked; http(s) links can be opened in the system browser on tap
 *  - device width simulated with a viewport meta + zoom-out for desktop/tablet
 */
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";
const WIDTH = { MOBILE: 390, TABLET: 834, DESKTOP: 1280, AGNOSTIC: 390 } as const;

export function HtmlPreview({ html, device = 'MOBILE', height = 520 }: { html: string; device?: keyof typeof WIDTH; height?: number }) {
  const c = useColors();
  const doc = useMemo(() => {
    const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=${WIDTH[device]}, user-scalable=yes"><script>document.addEventListener('click',function(e){var a=e.target.closest('a,button,[type=submit]');if(a){e.preventDefault();}},true);document.addEventListener('submit',function(e){e.preventDefault()},true);</script>`;
    let d = html || '<html><body></body></html>';
    d = d.replace(/<meta[^>]+name=["']viewport["'][^>]*>/gi, '');
    return /<head[^>]*>/i.test(d) ? d.replace(/<head([^>]*)>/i, `<head$1>${head}`) : `<head>${head}</head>${d}`;
  }, [html, device]);
  // Fade the page in once the WebView has painted; show a shimmer meanwhile.
  const [ready, setReady] = useState(false);
  const op = useSharedValue(0);
  useEffect(() => { setReady(false); op.value = 0; }, [doc, op]);
  const fade = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ scale: 0.985 + op.value * 0.015 }] }));
  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
      {!ready && <View style={{ position: 'absolute', inset: 0, padding: 16, gap: 12 }}><Skeleton height={28} width="55%" /><Skeleton height={140} /><Skeleton height={14} width="80%" /><Skeleton height={14} width="65%" /><Skeleton height={44} width="40%" radius={12} /></View>}
      <Animated.View style={[{ flex: 1 }, fade]}>
      <WebView
        onLoadEnd={() => { setReady(true); op.value = withTiming(1, { duration: 320 }); }}
        source={{ html: doc, baseUrl: 'about:blank' }}
        originWhitelist={['about:*', 'data:*']}
        javaScriptEnabled
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        geolocationEnabled={false}
        mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false}
        incognito
        scalesPageToFit
        onShouldStartLoadWithRequest={(r) => {
          if (r.url.startsWith('about:') || r.url.startsWith('data:')) return true;
          if (/^https?:/.test(r.url) && r.isTopFrame && r.navigationType === 'click') Linking.openURL(r.url);
          return false;
        }}
        style={{ backgroundColor: '#fff' }}
      />
      </Animated.View>
    </View>
  );
}
