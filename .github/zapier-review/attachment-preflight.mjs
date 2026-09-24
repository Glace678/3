export function validateAttachmentReceipt(plan,receipt,now=Date.now()){
  const age=now-Date.parse(receipt?.verifiedAt);
  const expected=plan.attachments||(plan.attachmentUrl?[{url:plan.attachmentUrl,sha256:plan.attachmentSha256,bytes:plan.attachmentBytes}]:[]);
  if(!expected.length||receipt?.inputSha256!==plan.inputSha256||!Number.isFinite(age)||age<0||age>15*60*1000||JSON.stringify(receipt.attachments)!==JSON.stringify(expected.map(({url,sha256,bytes})=>({url,sha256,bytes}))))throw Error('Require recent successful attachment download/hash verification before reserving a model call');
}
