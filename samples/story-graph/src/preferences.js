export const defaultPreferences = { language:'ja', writingMode:'horizontal', actorBold:false, bodyFont:'serif', bodySize:17, lineHeight:2.1, titleSize:18, leftPanelOpen:true, rightPanelOpen:false };
export const fontFamilies = {
  serif:'"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK SC", serif',
  sans:'"Hiragino Sans", "Yu Gothic", "Noto Sans CJK SC", sans-serif',
  mono:'"SFMono-Regular", Menlo, "Noto Sans Mono CJK SC", monospace'
};
export function applyPreferences(value) {
  document.documentElement.classList.toggle('vertical-writing',value.writingMode==='vertical');
  document.documentElement.classList.toggle('actor-bold',value.actorBold===true);
  const style = document.documentElement.style;
  style.setProperty('--body-font', fontFamilies[value.bodyFont] || fontFamilies.serif);
  style.setProperty('--body-size', `${value.bodySize}px`);
  style.setProperty('--body-leading', String(value.lineHeight));
  style.setProperty('--title-size', `${value.titleSize}px`);
}
