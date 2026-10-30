export function validateGoogleRelease(manifest,clientId){
 if(!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(clientId||'')||manifest.oauth2?.client_id!==clientId)throw new Error('发布包缺少应用 Google OAuth Client ID，或构建产物与应用配置不一致。请发布者配置并重新构建；不能要求普通用户补配。');
 if(!manifest.permissions?.includes('identity')||manifest.oauth2.scopes?.length!==1||manifest.oauth2.scopes[0]!=='https://www.googleapis.com/auth/drive.appdata')throw new Error('Google 发布配置需要 identity 权限和唯一的 drive.appdata 范围。');
 return true;
}
