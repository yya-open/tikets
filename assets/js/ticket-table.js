(function () {
  function appendCell(row, value) { row.insertCell(-1).innerText = value || ''; }
  function button(text, cls, onClick) { const b = document.createElement('button'); b.type='button'; b.className=cls; b.textContent=text; b.onclick=onClick; return b; }
  function renderRows(tbody, rows, viewMode, handlers) {
    rows.forEach((r) => {
      const row = tbody.insertRow();
      appendCell(row, r.date); appendCell(row, r.issue); appendCell(row, r.department); appendCell(row, r.name); appendCell(row, r.solution); appendCell(row, r.remarks); appendCell(row, r.type);
      const action = row.insertCell(-1);
      if (viewMode === 'trash') {
        action.appendChild(button('恢复', 'small', () => handlers.onRestore && handlers.onRestore(r.id)));
        action.appendChild(button('彻底删除', 'small danger', () => handlers.onHardDelete && handlers.onHardDelete(r.id)));
      } else {
        action.appendChild(button('编辑', 'small', () => handlers.onEdit && handlers.onEdit(r.id)));
        action.appendChild(button('删除', 'small danger', () => handlers.onDelete && handlers.onDelete(r.id)));
      }
    });
  }
  function renderPagination(el, { totalItems, currentPage, pageSize, totalPages, onChangePage, onChangePageSize }) {
    const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(totalItems, currentPage * pageSize);
    el.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'page-info';
    info.textContent = `显示 ${start}-${end} / ${totalItems} 条`;
    const controls = document.createElement('div');
    controls.className = 'page-controls';
    const mk = (label, page, disabled) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.disabled=disabled; if (!disabled) b.onclick=()=>onChangePage(page); return b; };
    controls.appendChild(mk('首页', 1, currentPage <= 1 || totalItems === 0));
    controls.appendChild(mk('上一页', currentPage - 1, currentPage <= 1 || totalItems === 0));
    const tag = document.createElement('span'); tag.textContent = `第 ${currentPage} / ${totalPages} 页`; controls.appendChild(tag);
    controls.appendChild(mk('下一页', currentPage + 1, currentPage >= totalPages || totalItems === 0));
    controls.appendChild(mk('末页', totalPages, currentPage >= totalPages || totalItems === 0));
    const size = document.createElement('select'); size.className='page-size'; [20,50,100].forEach((n)=>{const o=document.createElement('option'); o.value=String(n); o.textContent=`${n} 条`; if (n===pageSize) o.selected=true; size.appendChild(o);}); size.onchange=()=>onChangePageSize(Number(size.value)||100); controls.appendChild(size);
    el.appendChild(info); el.appendChild(controls);
  }
  window.TicketTable = { renderRows, renderPagination };
})();
