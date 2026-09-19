/**
 * dsh-soul-memory / src/messages.mjs — 中文报错语料(纯文本,零依赖)
 *
 * 自 soul-memory.mjs 集中迁出(2026-09-13 ALPHA_0.5 taste 整理):错误文案逐字
 * 未动,只换住处。root 写面与 logfile 写面共享 needContent/correctBan,故语料
 * 独立成模块,两条写路径不必互相依赖;「细则只在报错文案教学」是既有风格。
 */

/** 共用报错语料(rootNeedSection/needContent/correctBan 等的唯一定义点)。 */
export const MSG = {
  rootNeedSection: 'scope=root 需要 section(## 小节名)。',
  logfileNeedParams: 'scope=home/project 需要 name 与 title。',
  needContent: 'append 需要 content。',
  correctBan: '订正正文禁止以 "# " 或 "## " 开头的行;多块请用 "### " 分单元。',
  appendBan: 'content 禁止以 "# " 或 "## " 开头的行:"## " 会分裂小节边界;多块内容请用 "### "。',
  entryBan: '条目正文禁止以 "# " 或 "## " 开头的行;多块请用 "### " 分单元。',
  badSection: '非法 section:不得包含换行;不得以 "#" 开头;长度 <= 64 字符。',
}

/** root 写超限的拒绝文案(附压缩指引)。 */
export function overLimitMessage(len, maxChars) {
  return '拒绝写入:结果达 ' + len + ' 字符,超上限 ' + maxChars + ' 字符。压缩:memory_recall(scope=root) 读全文 -> 对臃肿小节用 memory_correct 重写瘦身(节内按 ### 单元整理)。'
}

/** memory_creator 的非法 type 报错。 */
export function illegalTypeMessage() { return '非法 type(仅 user | feedback | project | situation | reference)。' }

/** memory_creator 的缺 description 报错。 */
export function missingDescriptionMessage() { return 'description 必填且非空。' }
