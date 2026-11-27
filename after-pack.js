const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icoPath = path.join(context.packager.projectDir, 'public', 'app-icon.ico');
  const mod = await import('rcedit');
  const rceditFn = mod.rcedit || mod.default;
  await rceditFn(exePath, { icon: icoPath });
  console.log('  • Custom Dijipin .ico stamped onto executable:', exePath);
};
