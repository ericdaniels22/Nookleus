import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aaacontracting.platform',
  appName: 'Nookleus',
  webDir: 'out',
  // WebView background = the dark canvas (--background, design-system §7.6)
  // so load/overscroll gaps never flash a different color.
  backgroundColor: '#0B0F0EFF',
  server: {
    url: 'https://aaaplatform.vercel.app',
    cleartext: false,
    errorPath: 'index.html',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0B0F0EFF',
  },
};

export default config;
