(() => {
  'use strict';

  const config = window.STORE_CONFIG || {};
  const ORDER_HISTORY_KEY = 'whatsapp-store-order-history';
  const ORDER_HISTORY_TTL = 7 * 24 * 60 * 60 * 1000;
  const ORDER_HISTORY_LIMIT = 10;
  const state = { products: [], cart: loadCart(), orderHistory: loadOrderHistory(), search: '', color: '', size: '', category: '', checkoutConfirming: false, checkoutScrollPending: false };
  const $ = (selector) => document.querySelector(selector);

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem('whatsapp-store-cart') || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  }
  function saveCart() { localStorage.setItem('whatsapp-store-cart', JSON.stringify(state.cart)); }
  function loadOrderHistory() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) || '[]');
    } catch { return []; }
    if (!Array.isArray(saved)) return [];
    const recent = saved.filter(order => isRecentOrder(order, Date.now()));
    if (recent.length !== saved.length) {
      try { localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(recent)); } catch {}
    }
    return recent;
  }
  function isRecentOrder(order, now) {
    return order && Number.isFinite(order.createdAt) && now >= order.createdAt && now - order.createdAt < ORDER_HISTORY_TTL && Array.isArray(order.items);
  }
  function pruneOrderHistory() {
    const now = Date.now();
    const recent = state.orderHistory.filter(order => isRecentOrder(order, now));
    if (recent.length !== state.orderHistory.length) {
      state.orderHistory = recent;
      try { localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(recent)); } catch {}
    }
  }
  function saveOrderHistory(order) {
    pruneOrderHistory();
    const history = [order, ...state.orderHistory].slice(0, ORDER_HISTORY_LIMIT);
    try { localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(history)); }
    catch { return false; }
    state.orderHistory = history;
    renderOrderHistory();
    return true;
  }
  function money(amount) {
    const currency = config.currency || 'INR';
    try { return new Intl.NumberFormat(config.locale || 'en-IN', { style:'currency', currency, maximumFractionDigits:0 }).format(amount); }
    catch { return `${currency} ${Number(amount).toFixed(0)}`; }
  }
  function getWhatsAppNumber() {
    const chunks = config.whatsappNumberPartsEncoded;
    if (!Array.isArray(chunks) || chunks.length === 0 || !chunks.every(chunk => typeof chunk === 'string' && /^\d+$/.test(chunk))) return '';
    const number = chunks.map(chunk =>
      [...chunk].reverse().map(digit => String((Number(digit) + 7) % 10)).join('')
    ).join('');
    return /^\d{8,15}$/.test(number) ? number : '';
  }
  function notice(message) { const el = $('#notice'); el.textContent = message; el.hidden = false; }
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function thumbnailPath(source) {
    if (!source || /^https?:/i.test(source) || !/^images\//i.test(source)) return source || '';
    const filename = source.split('/').pop() || '';
    const base = filename.replace(/\.(jpg|jpeg|png|webp|gif|avif)$/i, '');
    return base ? `images/thumbnails/${base}.webp` : source;
  }

  function parseCSV(text) {
    const rows = [], row = []; let cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    const pushRow = () => { rows.push(row.slice()); row.length = 0; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); cell = ''; pushRow(); }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); pushRow(); }
    const headers = rows.shift().map(h => h.trim().toLowerCase());
    return rows.filter(r => r.some(v => v.trim())).map(r => { const item = {}; headers.forEach((h,i) => item[h] = (r[i] || '').trim()); return item; });
  }

  function filteredProducts() {
    return state.products.filter(p => {
      const matchesSearch = `${p.id} ${p.name} ${p.description} ${p.size} ${p.color} ${p.category}`.toLowerCase().includes(state.search);
      return matchesSearch && (!state.category || p.category === state.category) && (!state.color || p.color === state.color) && (!state.size || p.size === state.size);
    });
  }

  function renderProducts() {
    const grid = $('#products'); grid.replaceChildren();
    const filtered = filteredProducts();
    $('#empty-state').hidden = filtered.length > 0;
    $('#product-count').textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

    filtered.forEach(product => {
      const card = make('article','product-card');
      card.dataset.productId=product.id;
      const imageWrap = make('div','product-image-wrap');
      const img = make('img','product-image'); const originalSource=product.images[0]||''; img.src=thumbnailPath(originalSource); img.alt=product.name; img.loading='lazy'; img.decoding='async'; img.tabIndex=0; img.setAttribute('role','button'); img.setAttribute('aria-label',`Zoom image for ${product.name}`);
      img.addEventListener('error',()=>{ if(originalSource&&img.src!==originalSource) img.src=originalSource; },{once:true});
      img.addEventListener('click',()=>openImageViewer(product));
      img.addEventListener('keydown',event=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault(); openImageViewer(product); } });
      const fallback = make('div','image-placeholder','Image coming soon'); fallback.hidden = true;
      img.onerror = () => { img.hidden = true; fallback.hidden = false; };
      if (product.discount) imageWrap.append(make('span','discount-badge',`${product.discount}% OFF`));
      imageWrap.append(img,fallback);

      const info = make('div','product-info');
      info.append(make('h3','product-title',product.name));
      const priceRow = make('div','price-row');
      priceRow.append(make('span','product-price',money(product.finalPrice)));
      if (product.discount) priceRow.append(make('span','original-price',money(product.price)));
      const meta = make('div','product-meta');
      if (product.color) {
        const colorDot = make('span','product-color-dot');
        colorDot.style.setProperty('--swatch-color',colorValue(product.color));
        colorDot.title = product.color;
        colorDot.setAttribute('aria-label',`Color: ${product.color}`);
        meta.append(colorDot);
      }
      meta.append(document.createTextNode(product.size ? ` · Size: ${product.size}` : ''));

      const actions = make('div','card-actions');
      const inBag=Number(state.cart[product.id])>0;
      const add = make('button',inBag?'add-button remove-button-state':'add-button',inBag?'Remove':'Add to bag'); add.type='button'; add.setAttribute('aria-pressed',String(inBag));
      add.addEventListener('click',()=>{
        if(inBag) delete state.cart[product.id];
        else state.cart[product.id]=1;
        saveCart(); setCheckoutConfirmation(false); renderCart(); renderProducts();
      });
      actions.append(add);
      info.append(priceRow,meta,actions); card.append(imageWrap,info); grid.append(card);
    });
  }

  function renderCart() {
    const items = $('#cart-items'); items.replaceChildren();
    const entries = state.products.filter(p => Number(state.cart[p.id])>0);
    const count = entries.reduce((sum,p)=>sum+Number(state.cart[p.id]),0);
    const total = entries.reduce((sum,p)=>sum+p.finalPrice*Number(state.cart[p.id]),0);
    $('#cart-count').textContent=count;
    $('.cart-link').setAttribute('aria-label',`Go to bag, ${count} item${count===1?'':'s'}`);
    $('#cart-empty').hidden=entries.length>0;
    $('#cart-policy-empty').hidden=entries.length>0;
    $('#cart-summary').hidden=entries.length===0;
    $('#clear-cart').hidden=entries.length===0;
    $('#dock-count').textContent=`Your bag · ${count} item${count===1?'':'s'}`;
    $('#cart-total').textContent=money(total);
    $('#dock-total').textContent=money(total);
    $('#checkout').disabled=entries.length===0;

    entries.forEach(p=>{
      const qty=Number(state.cart[p.id]); const row=make('div','cart-row');
      const img=make('img','cart-thumb'); const originalSource=p.images[0]||''; img.src=thumbnailPath(originalSource); img.alt=`View image for ${p.name}`; img.loading='lazy'; img.decoding='async'; img.tabIndex=0; img.setAttribute('role','button');
      img.addEventListener('error',()=>{ if(originalSource&&img.src!==originalSource) img.src=originalSource; });
      img.addEventListener('click',()=>openImageViewer(p));
      img.addEventListener('keydown',event=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault(); openImageViewer(p); } });
      const thumbWrap=make('div','cart-thumb-wrap');
      const viewOverlay=make('button','cart-view-overlay','View'); viewOverlay.type='button'; viewOverlay.setAttribute('aria-label',`View image for ${p.name}`); viewOverlay.addEventListener('click',()=>openImageViewer(p));
      thumbWrap.append(img,viewOverlay);
      const details=make('div');
      const nameButton=make('button','cart-product-name',p.name); nameButton.type='button'; nameButton.addEventListener('click',()=>showProductInCatalog(p.id));
      details.append(nameButton);
      details.append(make('div','cart-product-meta',`${p.color || ''}${p.color&&p.size?' · ':''}${p.size?'Size '+p.size:''} · ${money(p.finalPrice)}`));
      const end=make('div','cart-line-end');
      const remove=make('button','cart-remove-button','Remove'); remove.type='button'; remove.setAttribute('aria-label',`Remove ${p.name} from bag`); remove.addEventListener('click',()=>{ delete state.cart[p.id]; saveCart(); setCheckoutConfirmation(false); renderCart(); renderProducts(); });
      end.append(make('span','cart-line-total',money(p.finalPrice*qty)),remove); row.append(thumbWrap,details,end); items.append(row);
    });
  }

  function renderOrderHistory() {
    pruneOrderHistory();
    const list = $('#order-history-list');
    list.replaceChildren();
    $('#order-history-empty').hidden = state.orderHistory.length > 0;
    $('#clear-order-history').hidden = state.orderHistory.length === 0;

    state.orderHistory.forEach(order => {
      const details = make('details', 'history-order');
      const summary = make('summary', 'history-order-summary');
      const main = make('span', 'history-order-main');
      const date = new Date(order.createdAt);
      main.append(make('span', 'history-order-date', date.toLocaleString(config.locale || undefined, { dateStyle: 'medium', timeStyle: 'short' })));
      main.append(make('span', 'history-order-status', 'WhatsApp checkout started'));
      summary.append(main, make('strong', 'history-order-total', money(order.total)));
      details.append(summary);

      const content = make('div', 'history-order-content');
      const items = make('div', 'history-order-items');
      order.items.forEach(item => {
        const row = make('div', 'history-order-item');
        const description = [item.color, item.size ? `Size ${item.size}` : ''].filter(Boolean).join(' · ');
        const itemInfo = make('div', 'history-order-item-info');
        itemInfo.append(make('strong', '', item.name), make('span', '', `${description ? `${description} · ` : ''}${item.quantity} × ${money(item.unitPrice)}`));
        row.append(itemInfo, make('strong', 'history-order-item-total', money(item.lineTotal)));
        items.append(row);
      });
      const fulfillment = order.fulfillment === 'Delivery' && order.area
        ? `Delivery · ${order.area}`
        : 'Self pickup';
      content.append(items, make('p', 'history-order-fulfillment', fulfillment));
      details.append(content);
      list.append(details);
    });
  }

  function showProductInCatalog(productId) {
    state.search=''; state.category=''; state.color=''; state.size='';
    $('#search').value='';
    document.querySelectorAll('.category-pill').forEach(pill=>pill.setAttribute('aria-pressed','false'));
    $('#catalog-heading').textContent='All styles';
    document.querySelectorAll('.filter-pills button, .size-pills button').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.value===''));
    });
    renderProducts();
    requestAnimationFrame(()=>{
      const card=[...document.querySelectorAll('.product-card')].find(element=>element.dataset.productId===productId);
      if(card) card.scrollIntoView({behavior:'smooth',block:'center'});
    });
  }

  function makeFilterPills(containerId, values, stateKey, pillClass) {
    const container = $(containerId);
    container.replaceChildren();

    const all = make('button',pillClass,pillClass === 'color-swatch' ? '' : 'All');
    all.type = 'button';
    all.dataset.value = '';
    all.setAttribute('aria-pressed','true');
    if (pillClass === 'color-swatch') {
      all.classList.add('color-swatch-all');
      all.setAttribute('aria-label','Show all colors');
      all.title = 'All colors';
    }
    all.addEventListener('click',()=>selectFilter(containerId,stateKey,''));
    container.append(all);

    values.forEach(value=>{
      const pill = make('button',pillClass,pillClass === 'color-swatch' ? '' : value);
      pill.type = 'button';
      pill.dataset.value = value;
      pill.setAttribute('aria-pressed','false');
      if (pillClass === 'color-swatch') {
        pill.style.setProperty('--swatch-color',colorValue(value));
        pill.setAttribute('aria-label',`Filter by ${value}`);
        pill.title = value;
      }
      pill.addEventListener('click',()=>selectFilter(containerId,stateKey,value));
      container.append(pill);
    });
  }

  function colorValue(color) {
    const normalized = String(color).trim().toLowerCase();
    const colors = {
      black:'#171717', white:'#ffffff', green:'#4f7a5a', blue:'#4d7094',
      pink:'#d58ba4', yellow:'#e1c65a', beige:'#cbbda6', red:'#b64b50',
      orange:'#d98945', purple:'#745b8f', brown:'#80604d', grey:'#777777',
      gray:'#777777', multicolor:'conic-gradient(#b64b50,#e1c65a,#4f7a5a,#4d7094,#745b8f,#b64b50)'
    };
    return colors[normalized] || normalized;
  }

  function selectFilter(containerId, stateKey, value) {
    state[stateKey] = value;
    $(containerId).querySelectorAll('button').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.value === value));
    });
    renderProducts();
  }

  function populateFilters() {
    const colors = [...new Set(state.products.map(p=>p.color).filter(Boolean))].sort();
    const sizeOrder = ['XS','S','M','L','XL','XXL'];
    makeFilterPills('#color-filter',colors,'color','color-swatch');
    makeFilterPills('#size-filter',sizeOrder,'size','size-pill');
  }

  async function loadProducts() {
    try {
      const response=await fetch(config.catalogPath||'products.csv',{cache:'no-store'}); if(!response.ok) throw new Error(`Catalog request failed (${response.status})`);
      const records=parseCSV(await response.text());
      const products=records.map((row,index)=>{
        const price=Number(String(row.price||'').replace(/[^\d.-]/g,''));
        const discount=Math.max(0,Math.min(100,Number(String(row.discount_percentage||'0').replace(/[^\d.-]/g,''))||0));
        const images=[row.image1,row.image2,row.image3,row.image4,row.image5].filter(v=>v&&v.trim());
        return {id:row.id||`product-${index+1}`,name:row.name||'Unnamed product',price,finalPrice:Math.round(price*(1-discount/100)*100)/100,discount,size:row.size||'',color:row.color||'',category:row.category||'',description:row.description||'',images,status:(row.status||'').toLowerCase()};
      }).filter(p=>Number.isFinite(p.price)&&p.price>=0);
      if(!products.length) throw new Error('No valid products were found.');
      state.products=products.filter(p=>p.status!=='sold');
      state.cart=Object.fromEntries(Object.entries(state.cart).filter(([id,quantity])=>state.products.some(p=>p.id===id)&&Number(quantity)>0).map(([id,quantity])=>[id,Math.max(1,Math.floor(Number(quantity))) ]));
      saveCart(); populateFilters(); renderProducts(); renderCart();
    } catch(error) { notice(error.message); $('#empty-state').textContent='The catalog could not be loaded.'; $('#empty-state').hidden=false; }
  }

  $('#search').addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();renderProducts();});
  document.querySelectorAll('.category-pill').forEach(button=>{
    button.addEventListener('click',()=>{
      const category=button.dataset.category;
      state.category=state.category===category?'':category;
      document.querySelectorAll('.category-pill').forEach(pill=>{
        pill.setAttribute('aria-pressed',String(pill.dataset.category===state.category));
      });
      $('#catalog-heading').textContent=state.category ? `${state.category === 'Co-Ord Set' ? 'Co-Ord Sets' : 'Kurta Sets'}` : 'All styles';
      renderProducts();
    });
  });
  const sectionFocusTimers = new WeakMap();
  function highlightSection(section) {
    section.classList.remove('section-focus');
    void section.offsetWidth;
    section.classList.add('section-focus');
    clearTimeout(sectionFocusTimers.get(section));
    sectionFocusTimers.set(section,window.setTimeout(()=>{
      section.classList.remove('section-focus');
      sectionFocusTimers.delete(section);
    },1400));
  }
  function scrollToSection(section) {
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'start'});
    if(reducedMotion){highlightSection(section);return;}

    let completed=false;
    let fallbackTimer;
    const onScrollEnd=()=>{
      if(completed)return;
      completed=true;
      clearTimeout(fallbackTimer);
      document.removeEventListener('scrollend',onScrollEnd);
      highlightSection(section);
    };
    document.addEventListener('scrollend',onScrollEnd,{once:true});
    fallbackTimer=window.setTimeout(onScrollEnd,600);
  }
  function scrollToBag() {
    state.checkoutScrollPending=true;
    scrollToSection($('#cart'));
    window.setTimeout(()=>{ state.checkoutScrollPending=false; },700);
  }

  function isBagVisible() {
    const bag=$('#cart');
    const rect=bag.getBoundingClientRect();
    return rect.bottom>0&&rect.top<window.innerHeight&&rect.top<window.innerHeight*.65;
  }

  window.addEventListener('scroll',()=>{
    if(!state.checkoutConfirming||state.checkoutScrollPending) return;
    if(!isBagVisible()) setCheckoutConfirmation(false);
  },{passive:true});

  $('.cart-dock').addEventListener('click',event=>{
    if(!event.target.closest('#checkout')) scrollToBag();
  });
  $('.cart-link').addEventListener('click',event=>{
    event.preventDefault();
    scrollToSection($('#cart'));
  });
  $('#open-order-history').addEventListener('click',()=>{
    scrollToSection($('#order-history'));
  });
  function setCheckoutConfirmation(confirming) {
    state.checkoutConfirming=confirming;
    const button=$('#checkout');
    button.querySelector('.checkout-label').textContent=confirming?'Confirm & send':'Place order';
  }

  $('#clear-cart').addEventListener('click',()=>{state.cart={};saveCart();setCheckoutConfirmation(false);renderCart();renderProducts();});
  function openPolicies() {
    const dialog=$('#policies-dialog');
    if(typeof dialog.showModal==='function') {
      if(!dialog.open) dialog.showModal();
    } else dialog.setAttribute('open','');
  }
  function closePolicies() {
    const dialog=$('#policies-dialog');
    if(typeof dialog.close==='function') dialog.close();
    else dialog.removeAttribute('open');
  }
  $('#open-policies-cart').addEventListener('click',openPolicies);
  $('#open-policies-cart-empty').addEventListener('click',openPolicies);
  $('#close-policies').addEventListener('click',closePolicies);
  $('#policies-dialog').addEventListener('click',event=>{ if(event.target===event.currentTarget) closePolicies(); });
  document.querySelectorAll('input[name="fulfillment"]').forEach(input=>{
    input.addEventListener('change',()=>{
      const isDelivery=input.value==='Delivery';
      $('#delivery-area-wrap').hidden=!isDelivery;
      $('#delivery-charge-note').hidden=!isDelivery;
      $('#delivery-area-error').hidden=true;
      $('#delivery-area').removeAttribute('aria-invalid');
      if(input.value==='Self pickup') $('#delivery-area').value='';
    });
  });
  $('#delivery-area').addEventListener('change',()=>{
    $('#delivery-area-error').hidden=true;
    $('#delivery-area').removeAttribute('aria-invalid');
  });
  $('#checkout').addEventListener('click',()=>{
    const entries=state.products.filter(p=>Number(state.cart[p.id])>0); if(!entries.length)return;
    if(!state.checkoutConfirming&&!isBagVisible()){
      setCheckoutConfirmation(true);
      scrollToBag();
      return;
    }
    const number=getWhatsAppNumber();
    if(!number){ notice('Configure a valid encoded WhatsApp number in config.js.'); return; }
    const lines=entries.flatMap((p,index)=>{
      const quantity=Number(state.cart[p.id]);
      const itemTotal=p.finalPrice*quantity;
      const details=[
        `${index+1}. ${p.id} - ${p.name}`,
        `   Size: ${p.size||'-'}`,
        `   Quantity: ${quantity}`,
        `   Price: ${money(p.price)} each`,
        `   Discount: ${p.discount}%`,
        `   Item total: ${money(itemTotal)}`
      ];
      if(p.color) details.splice(2,0,`   Color: ${p.color}`);
      return [...details,''];
    });
    const total=entries.reduce((sum,p)=>sum+p.finalPrice*Number(state.cart[p.id]),0);
    const storeName=config.storeName||'The Store';
    const fulfillment=document.querySelector('input[name="fulfillment"]:checked')?.value||'Self pickup';
    const area=$('#delivery-area').value;
    if(fulfillment==='Delivery'&&!area){
      $('#delivery-area-error').hidden=false;
      $('#delivery-area').setAttribute('aria-invalid','true');
      scrollToBag();
      requestAnimationFrame(()=>{
        $('#delivery-area').focus({preventScroll:true});
        $('#delivery-area-wrap').scrollIntoView({behavior:'smooth',block:'center'});
      });
      return;
    }
    const fulfillmentDetails=fulfillment==='Delivery'
      ? [`Fulfillment: Delivery`,`Delivery area: ${area}`,'Delivery city: Pune, Maharashtra','Delivery charges: Separate; to be confirmed']
      : ['Fulfillment: Self pickup','Pickup location: Venkatesh Graffiti, Keshav Nagar, Mundhwa, Pune, Maharashtra'];
    const message=[`Hello ${storeName},`,'',"I'd like to place an order:",'',...lines,`Estimated total: ${money(total)}`,'',...fulfillmentDetails,'','Please confirm product availability.','','Thank you!'].join('\n');
    const order = {
      createdAt: Date.now(),
      items: entries.map(product => {
        const quantity = Number(state.cart[product.id]);
        return { id: product.id, name: product.name, color: product.color, size: product.size, quantity, unitPrice: product.finalPrice, lineTotal: product.finalPrice * quantity };
      }),
      total,
      fulfillment,
      area: fulfillment === 'Delivery' ? area : ''
    };
    const whatsappUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    if (!saveOrderHistory(order)) {
      notice('Could not save order history. Your bag is unchanged; please try again.');
      return;
    }
    state.cart = {};
    saveCart();
    setCheckoutConfirmation(false);
    renderCart();
    renderProducts();
    window.open(whatsappUrl,'_blank','noopener,noreferrer');
  });

  let viewerImages=[];
  let viewerIndex=0;
  let viewerZoom=1;

  function openImageViewer(product) {
    viewerImages=product.images.length?product.images:[''];
    viewerIndex=0;
    viewerZoom=1;
    $('#viewer-title').textContent=product.name;
    const dialog=$('#image-viewer');
    updateImageViewer();
    if(typeof dialog.showModal==='function') {
      if(!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open','');
    }
  }

  let viewerLoadVersion=0;

  function updateImageViewer() {
    const image=$('#viewer-image');
    const stage=$('#viewer-stage');
    const source=viewerImages[viewerIndex]||'';
    const thumbnail=thumbnailPath(source);
    const loadVersion=++viewerLoadVersion;

    image.src=thumbnail;
    image.decoding='async';
    image.alt=source?`Product image ${viewerIndex+1} of ${viewerImages.length}`:'Image unavailable';
    $('#viewer-prev').disabled=viewerImages.length<2;
    $('#viewer-next').disabled=viewerImages.length<2;
    $('#viewer-zoom-out').disabled=viewerZoom===1;
    $('#viewer-zoom-in').disabled=viewerZoom===3;
    $('#viewer-zoom-label').textContent=`${viewerZoom*100}%`;
    stage.classList.toggle('is-zoomed',viewerZoom>1);
    image.style.width=viewerZoom>1?`${viewerZoom*100}%`:'';
    image.style.height=viewerZoom>1?`${viewerZoom*100}%`:'';
    stage.scrollTo({left:0,top:0});

    if(source&&thumbnail!==source){
      const fullImage=new Image();
      fullImage.decoding='async';
      fullImage.onload=()=>{
        if(loadVersion===viewerLoadVersion&&viewerImages[viewerIndex]===source){
          image.src=source;
        }
      };
      fullImage.src=source;
    }
  }

  function closeImageViewer() {
    const dialog=$('#image-viewer');
    if(typeof dialog.close==='function') dialog.close();
    else dialog.removeAttribute('open');
  }

  $('#viewer-close').addEventListener('click',closeImageViewer);
  $('#image-viewer').addEventListener('click',event=>{ if(event.target===event.currentTarget) closeImageViewer(); });
  $('#image-viewer').addEventListener('close',()=>{
    viewerLoadVersion++;
    $('#viewer-image').removeAttribute('src');
    $('#viewer-stage').scrollTo({left:0,top:0});
  });
  $('#viewer-prev').addEventListener('click',()=>{ viewerIndex=(viewerIndex-1+viewerImages.length)%viewerImages.length; viewerZoom=1; updateImageViewer(); });
  $('#viewer-next').addEventListener('click',()=>{ viewerIndex=(viewerIndex+1)%viewerImages.length; viewerZoom=1; updateImageViewer(); });
  $('#viewer-zoom-out').addEventListener('click',()=>{ viewerZoom=Math.max(1,viewerZoom-1); updateImageViewer(); });
  $('#viewer-zoom-in').addEventListener('click',()=>{ viewerZoom=Math.min(3,viewerZoom+1); updateImageViewer(); });
  $('#viewer-image').addEventListener('click',()=>{ viewerZoom=viewerZoom===1?2:1; updateImageViewer(); });

  let pinchStartDistance=0;
  let pinchStartZoom=1;
  $('#viewer-stage').addEventListener('touchstart',event=>{
    if(event.touches.length===2){
      const [first,second]=event.touches;
      pinchStartDistance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);
      pinchStartZoom=viewerZoom;
    }
  },{passive:true});
  $('#viewer-stage').addEventListener('touchmove',event=>{
    if(event.touches.length===2&&pinchStartDistance){
      event.preventDefault();
      const [first,second]=event.touches;
      const distance=Math.hypot(second.clientX-first.clientX,second.clientY-first.clientY);
      viewerZoom=Math.max(1,Math.min(3,Math.round(pinchStartZoom*distance/pinchStartDistance)));
      updateImageViewer();
    }
  },{passive:false});

  $('#store-name').textContent=config.storeName||'Style Store';
  $('#footer-store-name').textContent=config.storeName||'Style Store';
  document.title=`${config.storeName||'Style Store'} | Catalog`;
  renderOrderHistory();
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden) renderOrderHistory();
  });
  $('#clear-order-history').addEventListener('click',()=>{
    try {
      localStorage.removeItem(ORDER_HISTORY_KEY);
      state.orderHistory=[];
      renderOrderHistory();
    } catch { notice('Could not clear order history from this browser.'); }
  });
  loadProducts();
})();
