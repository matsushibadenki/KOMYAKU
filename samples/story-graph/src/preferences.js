export const defaultPreferences = { language:'ja', writingMode:'horizontal', actorBold:false, lineBreak:'strict', bodyFont:'serif', bodySize:18, lineHeight:2.1, titleSize:22, blockSize:30, sequenceSize:25, leftPanelOpen:true, rightPanelOpen:false };
export const fontFamilies = {
  serif:'"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK SC", serif',
  sans:'"Hiragino Sans", "Yu Gothic", "Noto Sans CJK SC", sans-serif',
  mono:'"SFMono-Regular", Menlo, "Noto Sans Mono CJK SC", monospace'
};
export function applyPreferences(value) {
  document.documentElement.classList.toggle('vertical-writing',value.writingMode==='vertical');
  document.documentElement.classList.toggle('actor-bold',value.actorBold===true);
  const style = document.documentElement.style;
  style.setProperty('--body-line-break', ['strict','normal','loose'].includes(value.lineBreak)?value.lineBreak:'strict');
  style.setProperty('--body-font', fontFamilies[value.bodyFont] || fontFamilies.serif);
  style.setProperty('--body-size', `${value.bodySize}px`);
  style.setProperty('--body-leading', String(value.lineHeight));
  style.setProperty('--title-size', `${value.titleSize}px`);
  style.setProperty('--block-size', `${value.blockSize ?? defaultPreferences.blockSize}px`);
  style.setProperty('--sequence-size', `${value.sequenceSize ?? defaultPreferences.sequenceSize}px`);
}
