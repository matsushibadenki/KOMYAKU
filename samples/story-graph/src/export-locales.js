import {messages} from './locales.js';
Object.assign(messages.ja,{exportPdfStandard:'標準',exportScript:'台本',exportScriptLayout:'台本：A4・縦書き'});
Object.assign(messages.en,{exportPdfStandard:'Standard',exportScript:'Screenplay',exportScriptLayout:'Screenplay: A4, vertical text'});
Object.assign(messages['zh-CN'],{exportPdfStandard:'标准',exportScript:'剧本',exportScriptLayout:'剧本：A4纸张、竖排'});
Object.assign(messages.ja,{export:'書き出し',exportText:'プレーンテキスト（.txt）',exportMarkdown:'マークダウン（.md）',exportPdf:'PDF（.pdf）',exportScope:'作品全体（別展開を含む）',exportPdfLayout:'PDF：A4・横書き',exportReady:'書き出しが完了しました。',export_failed:'書き出せませんでした。保存先と空き容量を確認してください。',export_pdf_failed:'PDFを生成できませんでした。利用可能なフォントを確認してください。',export_extension_invalid:'選択した形式に合う拡張子で保存してください。'});
Object.assign(messages.en,{export:'Export',exportText:'Plain text (.txt)',exportMarkdown:'Markdown (.md)',exportPdf:'PDF (.pdf)',exportScope:'Entire work, including alternate scenes.',exportPdfLayout:'PDF: A4, horizontal text',exportReady:'Export complete.',export_failed:'Could not export. Check the destination and free space.',export_pdf_failed:'Could not generate the PDF. Check available fonts.',export_extension_invalid:'Save with the extension matching the selected format.'});
Object.assign(messages['zh-CN'],{export:'导出',exportText:'纯文本（.txt）',exportMarkdown:'マークダウン（.md）',exportPdf:'PDF（.pdf）',exportScope:'导出整部作品（含其他分支）',exportPdfLayout:'PDF：A4纸张、横排',exportReady:'导出完成。',export_failed:'无法导出。请检查保存位置和可用空间。',export_pdf_failed:'无法生成PDF。请检查可用字体。',export_extension_invalid:'请使用与所选格式匹配的扩展名保存。'});

Object.assign(messages['zh-CN'],{exportMarkdown:'Markdown（.md）'});

Object.assign(messages.ja,{importWorkspace:'snapshotを取り込む…'});
Object.assign(messages.en,{importWorkspace:'Import snapshot…'});
Object.assign(messages['zh-CN'],{importWorkspace:'导入快照…'});

Object.assign(messages.ja,{exportScope:'書き出す範囲を選択できます。'});
Object.assign(messages.en,{exportScope:'Choose the range to export.'});
Object.assign(messages['zh-CN'],{exportScope:'可选择导出范围。'});

Object.assign(messages.ja,{exportArchive:'履歴を含めて書き出す…',importArchive:'履歴を含む作品を取り込む…',archiveReady:'履歴を含む作品を書き出しました。',archive_invalid:'Archiveが破損しているか、未対応の形式です。',archive_failed:'Archiveを処理できませんでした。保存先と空き容量を確認してください。',archive_extension_invalid:'.komyaku-storyの拡張子で保存してください。'});
Object.assign(messages.en,{exportArchive:'Export with history…',importArchive:'Import work with history…',archiveReady:'Work and history exported.',archive_invalid:'The archive is corrupt or its format is unsupported.',archive_failed:'Could not process the archive. Check the destination and free space.',archive_extension_invalid:'Save with the .komyaku-story extension.'});
Object.assign(messages['zh-CN'],{exportArchive:'导出作品和历史…',importArchive:'导入作品和历史…',archiveReady:'作品和历史已导出。',archive_invalid:'归档已损坏或格式不受支持。',archive_failed:'无法处理归档，请检查保存位置和可用空间。',archive_extension_invalid:'请使用.komyaku-story扩展名保存。'});

for(const [language,values]of Object.entries({
 ja:{exportGraphPng:'人物相関図（PNG）…',exportGraphPdf:'人物相関図（PDF）…',graph_export_empty:'書き出す人物がありません。',graph_export_too_large:'配置範囲が大きすぎます。ノードを近づけてください。',graph_export_failed:'人物相関図を書き出せませんでした。',graph_gpu_unavailable:'画像書き出し用のGPUを利用できません。',graph_export_invalid:'書き出し形式を確認してください。'},
 en:{exportGraphPng:'Relationship graph (PNG)…',exportGraphPdf:'Relationship graph (PDF)…',graph_export_empty:'No characters to export.',graph_export_too_large:'The layout is too large. Move the nodes closer together.',graph_export_failed:'Could not export the relationship graph.',graph_gpu_unavailable:'A GPU is unavailable for image export.',graph_export_invalid:'Check the export format.'},
 'zh-CN':{exportGraphPng:'人物关系图（PNG）…',exportGraphPdf:'人物关系图（PDF）…',graph_export_empty:'没有可导出的人物。',graph_export_too_large:'布局范围过大，请将节点移近。',graph_export_failed:'无法导出人物关系图。',graph_gpu_unavailable:'无法使用图片导出所需的GPU。',graph_export_invalid:'请检查导出格式。'}
}))Object.assign(messages[language],values);

Object.assign(messages.ja,{exportSharedWorkspace:'共有Story Workspaceを書き出す…',shared_workspace_invalid:'共有Workspaceの構造を検証できませんでした。',shared_workspace_unsupported:'この共有Workspaceには未対応の情報が含まれています。'});
Object.assign(messages.en,{exportSharedWorkspace:'Export shared Story Workspace…',shared_workspace_invalid:'The shared Workspace structure could not be validated.',shared_workspace_unsupported:'This shared Workspace contains unsupported information.'});
Object.assign(messages['zh-CN'],{exportSharedWorkspace:'导出共享Story Workspace…',shared_workspace_invalid:'无法验证共享Workspace的结构。',shared_workspace_unsupported:'此共享Workspace包含不支持的信息。'});

Object.assign(messages.ja,{importWorkspace:'snapshot／共有Workspaceを取り込む…'});
Object.assign(messages.en,{importWorkspace:'Import snapshot / shared Workspace…'});
Object.assign(messages['zh-CN'],{importWorkspace:'导入快照／共享Workspace…'});

Object.assign(messages.ja,{exportSharedArchive:'共有Archiveを書き出す…',shared_archive_invalid:'共有Archiveの形式または整合性を確認できませんでした。'});
Object.assign(messages.en,{exportSharedArchive:'Export shared Archive…',shared_archive_invalid:'The shared Archive format or integrity could not be verified.'});
Object.assign(messages['zh-CN'],{exportSharedArchive:'导出共享Archive…',shared_archive_invalid:'无法验证共享Archive的格式或完整性。'});

Object.assign(messages.ja,{importWorkspace:'snapshot／共有Workspace・Archiveを取り込む…'});
Object.assign(messages.en,{importWorkspace:'Import snapshot / shared Workspace or Archive…'});
Object.assign(messages['zh-CN'],{importWorkspace:'导入快照／共享Workspace或Archive…'});

for(const [locale,text] of Object.entries({ja:'共有履歴Archiveを書き出す…',en:'Export shared history Archive…','zh-CN':'导出共享历史Archive…'}))messages[locale].exportSharedHistory=text;
