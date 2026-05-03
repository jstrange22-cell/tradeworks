import{v as R,O as C,s as W,w as U,p as k,A as u,x as $,N as P,y as g,z as D,R as p,D as b,F as V,G as j,L as F,i as z,b as v,d as O,f as x,M as _,E as d,W as w,S as A,r as M,Y as J,J as X}from"./index-D-6HOs-Q.js";import{K as le}from"./index-D-6HOs-Q.js";import"./vendor-react-DICsUdBR.js";import"./vendor-ui-BkPAuTK0.js";import"./vendor-solana-C8jGMX4x.js";const o=k({status:"uninitialized"}),l={state:o,subscribeKey(n,e){return U(o,n,e)},subscribe(n){return W(o,()=>n(o))},_getClient(){if(!o._client)throw new Error("SIWEController client not set");return o._client},async getNonce(n){const t=await this._getClient().getNonce(n);return this.setNonce(t),t},async getSession(){try{const e=await this._getClient().getSession();return e&&(this.setSession(e),this.setStatus("success")),e}catch{return}},createMessage(n){const t=this._getClient().createMessage(n);return this.setMessage(t),t},async verifyMessage(n){return await this._getClient().verifyMessage(n)},async signIn(){return await this._getClient().signIn()},async signOut(){var e;const n=this._getClient();await n.signOut(),this.setStatus("ready"),this.setSession(void 0),(e=n.onSignOut)==null||e.call(n)},onSignIn(n){var t;const e=this._getClient();(t=e.onSignIn)==null||t.call(e,n)},onSignOut(){var e;const n=this._getClient();(e=n.onSignOut)==null||e.call(n)},setSIWEClient(n){o._client=R(n),o.status="ready",C.setIsSiweEnabled(n.options.enabled)},setNonce(n){o.nonce=n},setStatus(n){o.status=n},setMessage(n){o.message=n},setSession(n){o.session=n,o.status=n?"success":"ready"}},N={FIVE_MINUTES_IN_MS:3e5};class H{constructor(e){const{enabled:t=!0,nonceRefetchIntervalMs:i=N.FIVE_MINUTES_IN_MS,sessionRefetchIntervalMs:r=N.FIVE_MINUTES_IN_MS,signOutOnAccountChange:s=!0,signOutOnDisconnect:a=!0,signOutOnNetworkChange:c=!0,...y}=e;this.options={enabled:t,nonceRefetchIntervalMs:i,sessionRefetchIntervalMs:r,signOutOnDisconnect:a,signOutOnAccountChange:s,signOutOnNetworkChange:c},this.methods=y}async getNonce(e){const t=await this.methods.getNonce(e);if(!t)throw new Error("siweControllerClient:getNonce - nonce is undefined");return t}async getMessageParams(){var e,t;return await((t=(e=this.methods).getMessageParams)==null?void 0:t.call(e))||{}}createMessage(e){const t=this.methods.createMessage(e);if(!t)throw new Error("siweControllerClient:createMessage - message is undefined");return t}async verifyMessage(e){return await this.methods.verifyMessage(e)}async getSession(){const e=await this.methods.getSession();if(!e)throw new Error("siweControllerClient:getSession - session is undefined");return e}async signIn(){var E,I;if(!l.state._client)throw new Error("SIWE client needs to be initialized before calling signIn");const e=u.state.address,t=await this.methods.getNonce(e);if(!e)throw new Error("An address is required to create a SIWE message.");const i=$.getNetworkProp("caipNetwork");if(!(i!=null&&i.id))throw new Error("A chainId is required to create a SIWE message.");const r=P.caipNetworkIdToNumber(i.id);if(!r)throw new Error("A chainId is required to create a SIWE message.");const s=(E=l.state._client)==null?void 0:E.options.signOutOnNetworkChange;s&&(l.state._client.options.signOutOnNetworkChange=!1,await this.signOut()),await g.switchActiveNetwork(i),s&&(l.state._client.options.signOutOnNetworkChange=!0);const a=await((I=this.getMessageParams)==null?void 0:I.call(this)),c=this.methods.createMessage({address:`eip155:${r}:${e}`,chainId:r,nonce:t,version:"1",iat:(a==null?void 0:a.iat)||new Date().toISOString(),...a});D.getConnectedConnector()==="AUTH"&&p.pushTransactionStack({view:null,goBack:!1,replace:!0,onCancel(){p.replace("ConnectingSiwe")}});const T=await b.signMessage(c);if(!await this.methods.verifyMessage({message:c,signature:T}))throw new Error("Error verifying SIWE signature");const f=await this.methods.getSession();if(!f)throw new Error("Error verifying SIWE signature");return this.methods.onSignIn&&this.methods.onSignIn(f),V.navigateAfterNetworkSwitch(),f}async signOut(){var e,t;return(t=(e=this.methods).onSignOut)==null||t.call(e),this.methods.signOut()}}const Y=/0x[a-fA-F0-9]{40}/u,K=/Chain ID: (?<temp1>\d+)/u;function te(n){var e;return((e=n.match(Y))==null?void 0:e[0])||""}function ne(n){var e;return`eip155:${((e=n.match(K))==null?void 0:e[1])||1}`}async function se({address:n,message:e,signature:t,chainId:i,projectId:r}){let s=j(n,e,t);return s||(s=await F(n,e,t,i,r)),s}const L=z`
  :host {
    display: flex;
    justify-content: center;
    gap: var(--wui-spacing-2xl);
  }

  wui-visual-thumbnail:nth-child(1) {
    z-index: 1;
  }
`;var q=function(n,e,t,i){var r=arguments.length,s=r<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,t):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(n,e,t,i);else for(var c=n.length-1;c>=0;c--)(a=n[c])&&(s=(r<3?a(s):r>3?a(e,t,s):a(e,t))||s);return r>3&&s&&Object.defineProperty(e,t,s),s};let S=class extends v{constructor(){var e,t;super(...arguments),this.dappImageUrl=(e=C.state.metadata)==null?void 0:e.icons,this.walletImageUrl=(t=u.state.connectedWalletInfo)==null?void 0:t.icon}firstUpdated(){var t;const e=(t=this.shadowRoot)==null?void 0:t.querySelectorAll("wui-visual-thumbnail");e!=null&&e[0]&&this.createAnimation(e[0],"translate(18px)"),e!=null&&e[1]&&this.createAnimation(e[1],"translate(-18px)")}render(){var e;return O`
      <wui-visual-thumbnail
        ?borderRadiusFull=${!0}
        .imageSrc=${(e=this.dappImageUrl)==null?void 0:e[0]}
      ></wui-visual-thumbnail>
      <wui-visual-thumbnail .imageSrc=${this.walletImageUrl}></wui-visual-thumbnail>
    `}createAnimation(e,t){e.animate([{transform:"translateX(0px)"},{transform:t}],{duration:1600,easing:"cubic-bezier(0.56, 0, 0.48, 1)",direction:"alternate",iterations:1/0})}};S.styles=L;S=q([x("w3m-connecting-siwe")],S);var m=function(n,e,t,i){var r=arguments.length,s=r<3?e:i===null?i=Object.getOwnPropertyDescriptor(e,t):i,a;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")s=Reflect.decorate(n,e,t,i);else for(var c=n.length-1;c>=0;c--)(a=n[c])&&(s=(r<3?a(s):r>3?a(e,t,s):a(e,t))||s);return r>3&&s&&Object.defineProperty(e,t,s),s};let h=class extends v{constructor(){var e;super(...arguments),this.dappName=(e=C.state.metadata)==null?void 0:e.name,this.isSigning=!1,this.isCancelling=!1}render(){return this.onRender(),O`
      <wui-flex justifyContent="center" .padding=${["2xl","0","xxl","0"]}>
        <w3m-connecting-siwe></w3m-connecting-siwe>
      </wui-flex>
      <wui-flex
        .padding=${["0","4xl","l","4xl"]}
        gap="s"
        justifyContent="space-between"
      >
        <wui-text variant="paragraph-500" align="center" color="fg-100"
          >${this.dappName??"Dapp"} needs to connect to your wallet</wui-text
        >
      </wui-flex>
      <wui-flex
        .padding=${["0","3xl","l","3xl"]}
        gap="s"
        justifyContent="space-between"
      >
        <wui-text variant="small-400" align="center" color="fg-200"
          >Sign this message to prove you own this wallet and proceed. Canceling will disconnect
          you.</wui-text
        >
      </wui-flex>
      <wui-flex .padding=${["l","xl","xl","xl"]} gap="s" justifyContent="space-between">
        <wui-button
          size="lg"
          borderRadius="xs"
          fullWidth
          variant="neutral"
          ?loading=${this.isCancelling}
          @click=${this.onCancel.bind(this)}
          data-testid="w3m-connecting-siwe-cancel"
        >
          Cancel
        </wui-button>
        <wui-button
          size="lg"
          borderRadius="xs"
          fullWidth
          variant="main"
          @click=${this.onSign.bind(this)}
          ?loading=${this.isSigning}
          data-testid="w3m-connecting-siwe-sign"
        >
          ${this.isSigning?"Signing...":"Sign"}
        </wui-button>
      </wui-flex>
    `}onRender(){l.state.session&&_.close()}async onSign(){var e,t,i;this.isSigning=!0,d.sendEvent({event:"CLICK_SIGN_SIWE_MESSAGE",type:"track",properties:{network:((e=g.state.caipNetwork)==null?void 0:e.id)||"",isSmartAccount:u.state.preferredAccountType===w.ACCOUNT_TYPES.SMART_ACCOUNT}});try{l.setStatus("loading");const r=await l.signIn();return l.setStatus("success"),d.sendEvent({event:"SIWE_AUTH_SUCCESS",type:"track",properties:{network:((t=g.state.caipNetwork)==null?void 0:t.id)||"",isSmartAccount:u.state.preferredAccountType===w.ACCOUNT_TYPES.SMART_ACCOUNT}}),r}catch{const a=u.state.preferredAccountType===w.ACCOUNT_TYPES.SMART_ACCOUNT;return a?A.showError("This application might not support Smart Accounts"):A.showError("Signature declined"),l.setStatus("error"),d.sendEvent({event:"SIWE_AUTH_ERROR",type:"track",properties:{network:((i=g.state.caipNetwork)==null?void 0:i.id)||"",isSmartAccount:a}})}finally{this.isSigning=!1}}async onCancel(){var t;this.isCancelling=!0,u.state.isConnected?(await b.disconnect(),_.close()):p.push("Connect"),this.isCancelling=!1,d.sendEvent({event:"CLICK_CANCEL_SIWE",type:"track",properties:{network:((t=g.state.caipNetwork)==null?void 0:t.id)||"",isSmartAccount:u.state.preferredAccountType===w.ACCOUNT_TYPES.SMART_ACCOUNT}})}};m([M()],h.prototype,"isSigning",void 0);m([M()],h.prototype,"isCancelling",void 0);h=m([x("w3m-connecting-siwe-view")],h);function ae(n){return new H(n)}export{l as SIWEController,S as W3mConnectingSiwe,h as W3mConnectingSiweView,ae as createSIWEConfig,le as formatMessage,te as getAddressFromMessage,ne as getChainIdFromMessage,J as getDidAddress,X as getDidChainId,se as verifySignature};
