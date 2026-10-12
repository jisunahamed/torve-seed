const path = require('node:path');

module.exports = {
  extends: path.join(__dirname, 'electron-builder.yml'),
  productName: 'torve-ai-vpn',
  linux: {
    executableName: 'torve-ai-vpn',
    artifactName: 'Torve-AI-VPN-${version}-${arch}.${ext}',
    desktop: {
      Name: 'Torve AI VPN',
      StartupWMClass: 'Torve AI VPN',
    },
  },
  deb: {
    packageName: 'torve-ai-vpn',
    afterInstall: path.join(__dirname, 'scripts/linux/postinst.sh'),
    afterRemove: path.join(__dirname, 'scripts/linux/postrm.sh'),
    fpm: ['--before-install', path.join(__dirname, 'scripts/linux/preinst.sh')],
  },
};
