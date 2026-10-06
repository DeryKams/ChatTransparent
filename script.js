/**
 * ChatTransparent — JS-модуль.
 *
 * Рендерит кнопку(и) чата смарт-процесса в таймлайне сделки.
 * Внешне идентично нативному виджету чата сущности (crm-entity-stream-section-live-im).
 *
 * Логика:
 * 1. Ждёт загрузки таймлайна сделки (MutationObserver)
 * 2. Запрашивает через AJAX список смарт-процессов, привязанных к сделке
 * 3. Для каждого — рендерит блок-кнопку по нативной HTML-структуре:
 *    - Если чат есть: надпись "Чат Смарт-процесса" + последнее сообщение
 *    - Если чата нет: надпись "Пригласить к обсуждению" (при клике чат создастся)
 * 4. При клике — входит в чат по выбранному механизму доступа
 *
 * Конфигурация берётся из window.ChatTransparentConfig (инъекцируется handler.php).
 */

(function()
{
    'use strict';

    // ============================================================
    // КОНФИГУРАЦИЯ (из window.ChatTransparentConfig, задаётся в handler.php)
    // ============================================================

    var config = window.ChatTransparentConfig || {};
    var dealId = config.dealId || 0;
    var ajaxUrl = config.ajaxUrl || '';
    var buttonLabel = config.buttonLabel || 'Чат Смарт-процесса';
    var inviteLabel = config.inviteLabel || 'Пригласить к обсуждению';

    if (dealId <= 0 || !ajaxUrl)
    {
        return;
    }

    // ============================================================
    // СОСТОЯНИЕ
    // ============================================================

    var observer = null;       // MutationObserver
    var inserted = false;      // Флаг: кнопки уже вставлены
    var childChats = [];       // Данные о чатах смарт-процессов (из AJAX)

    // ============================================================
    // ТОЧКА ВХОДА
    // ============================================================

    BX.ready(function()
    {
        // Сначала запрашиваем данные о чатах смарт-процессов
        loadChildChats().then(function(chats)
        {
            childChats = chats;
            if (childChats.length === 0)
            {
                // Нет смарт-процессов, привязанных к сделке — ничего не рендерим
                return;
            }

            // Ждём появления таймлайна в DOM
            waitForTimeline();
        });
    });

    // ============================================================
    // AJAX: ЗАПРОС ДАННЫХ О ЧАТАХ СМАРТ-ПРОЦЕССОВ
    // ============================================================

    function loadChildChats()
    {
        return new Promise(function(resolve)
        {
            BX.ajax({
                url: ajaxUrl,
                method: 'POST',
                dataType: 'json',
                data: {
                    action: 'getChildChats',
                    dealId: dealId,
                    sessid: BX.message('bitrix_sessid')
                },
                onsuccess: function(response)
                {
                    resolve(Array.isArray(response) ? response : []);
                },
                onfailure: function()
                {
                    resolve([]);
                }
            });
        });
    }

    // ============================================================
    // ОЖИДАНИЕ ЗАГРУЗКИ ТАЙМЛАЙНА
    // ============================================================

    /**
     * Таймлайн сделки рендерится асинхронно (SPA), поэтому используем
     * MutationObserver, чтобы дождаться появления .crm-entity-stream-container.
     *
     * Альтернативный селектор: #deal_{dealId}_details_timeline_list
     */
    function waitForTimeline()
    {
        // Проверяем, не загружен ли уже таймлайн
        if (tryInsert())
        {
            return;
        }

        // Наблюдаем за появлением таймлайна
        observer = new MutationObserver(function(mutations)
        {
            if (inserted)
            {
                return;
            }
            tryInsert();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Таймаут на 30 секунд — если таймлайн не появился, отключаем наблюдатель
        setTimeout(function()
        {
            if (!inserted && observer)
            {
                observer.disconnect();
            }
        }, 30000);
    }

    // ============================================================
    // ВСТАВКА КНОПОК В ТАМЛАЙН
    // ============================================================

    /**
     * Ищет нативный блок чата сделки и вставляет кнопки смарт-процессов
     * сразу после него.
     *
     * @returns {boolean} true если вставка прошла успешно
     */
    function tryInsert()
    {
        if (inserted)
        {
            return true;
        }

        // Ищем контейнер таймлайна
        var timelineContainer = document.querySelector('.crm-entity-stream-container');
        if (!timelineContainer)
        {
            return false;
        }

        // Ищем нативный блок чата сделки (.crm-entity-stream-section-live-im)
        var nativeChatBlock = timelineContainer.querySelector('.crm-entity-stream-section-live-im');
        if (!nativeChatBlock)
        {
            // Нативный чат ещё не отрендерился — пробуем снова позже
            return false;
        }

        // Нативный чат найден — вставляем кнопки после него
        var insertAfter = nativeChatBlock;

        for (var i = 0; i < childChats.length; i++)
        {
            var chatData = childChats[i];
            var buttonElement = renderChatButton(chatData);

            // Вставляем после предыдущего блока (найденного нативного или предыдущей кнопки)
            insertAfter.parentNode.insertBefore(buttonElement, insertAfter.nextSibling);
            insertAfter = buttonElement;
        }

        inserted = true;

        // Отключаем наблюдатель — задача выполнена
        if (observer)
        {
            observer.disconnect();
        }

        return true;
    }

    // ============================================================
    // РЕНДЕР КНОПКИ ЧАТА (идентично нативному entitychat.js)
    // ============================================================

    /**
     * Создаёт DOM-элемент кнопки чата смарт-процесса.
     *
     * Два режима:
     * 1. Чат есть (hasChat=true): надпись "Чат Смарт-процесса" + последнее сообщение
     * 2. Чата нет (hasChat=false): надпись "Пригласить к обсуждению" + кнопка-приглашение
     *
     * Структура идентична нативной (см. BX.Crm.Timeline.Streams.EntityChat):
     *
     * <div class="crm-entity-stream-section crm-entity-stream-section-live-im ct-chat-button">
     *   <div class="crm-entity-stream-section-icon ... ct-chat-icon"></div>
     *   <div class="crm-entity-stream-section-content">
     *     <div class="crm-entity-stream-content-event">
     *       <div class="crm-entity-stream-content-live-im-detail">
     *         <div class="ct-chat-label">Чат Смарт-процесса | Пригласить к обсуждению</div>
     *         <div class="crm-entity-stream-live-im-users">
     *           <div class="crm-entity-stream-live-im-user-avatars">
     *             <span class="..."><i style="..."></i></span>
     *             <!-- если чата нет: -->
     *             <span class="crm-entity-stream-live-im-user-invite-btn"></span>
     *           </div>
     *         </div>
     *         <div class="crm-entity-stream-live-im-user-counter"></div>
     *         <!-- если чата нет: -->
     *         <div class="crm-entity-stream-live-im-user-invite-text">Пригласить к обсуждению</div>
     *         <!-- если чат есть: -->
     *         <div class="crm-entity-stream-live-im-separator"></div>
     *         <div class="crm-entity-stream-live-im-messanger">...</div>
     *       </div>
     *     </div>
     *   </div>
     * </div>
     */
    function renderChatButton(chatData)
    {
        // Корневой блок — идентичные классы с нативным + наш маркер ct-chat-button
        var section = document.createElement('div');
        section.className = 'crm-entity-stream-section crm-entity-stream-section-live-im ct-chat-button';

        // data-атрибуты для клик-обработчика
        section.setAttribute('data-entity-type-id', chatData.entityTypeId);
        section.setAttribute('data-entity-id', chatData.entityId);
        section.setAttribute('data-chat-id', chatData.chatId || 0);

        // Иконка (значок чата в левой части таймлайна).
        // Класс ct-chat-icon — наш маркер, позволяет задать кастомный цвет/значок
        // в style.css, чтобы отличить кнопку чата смарт-процесса от дефолтного чата сделки.
        var icon = document.createElement('div');
        icon.className = 'crm-entity-stream-section-icon crm-entity-stream-section-icon-live-im ct-chat-icon';
        section.appendChild(icon);

        // Контент-обёртка
        var content = document.createElement('div');
        content.className = 'crm-entity-stream-section-content';
        section.appendChild(content);

        // event-обёртка
        var event = document.createElement('div');
        event.className = 'crm-entity-stream-content-event';
        content.appendChild(event);

        // Внутренний detail-контейнер
        var detail = document.createElement('div');
        detail.className = 'crm-entity-stream-content-live-im-detail';
        event.appendChild(detail);



        // --- Аватары пользователей ---
        var usersWrapper = document.createElement('div');
        usersWrapper.className = 'crm-entity-stream-live-im-users';
        detail.appendChild(usersWrapper);

        var avatarsWrapper = document.createElement('div');
        avatarsWrapper.className = 'crm-entity-stream-live-im-user-avatars';
        usersWrapper.appendChild(avatarsWrapper);

        // Рендерим аватары (до 3 штук, как в нативном)
        var userInfos = chatData.userInfos || {};
        var userList = Object.values(userInfos);
        var avatarCount = Math.min(userList.length, 3);

        for (var i = 0; i < avatarCount; i++)
        {
            var userInfo = userList[i];
            var avatarSpan = document.createElement('span');
            avatarSpan.className = 'crm-entity-stream-live-im-user-avatar ui-icon ui-icon-common-user';

            var avatarIcon = document.createElement('i');
            // URL аватара берётся из поля avatar данных пользователя
            var avatarUrl = (userInfo && userInfo.avatar) ? userInfo.avatar : '';
            if (avatarUrl)
            {
                avatarIcon.style.backgroundImage = "url('" + encodeURI(avatarUrl) + "')";
            }
            avatarSpan.appendChild(avatarIcon);
            avatarsWrapper.appendChild(avatarSpan);
        }

        // Счётчик дополнительных пользователей (если больше 3)
        var counter = document.createElement('div');
        counter.className = 'crm-entity-stream-live-im-user-counter';
        if (userList.length > 3)
        {
            counter.textContent = '+' + (userList.length - 3);
        }
        detail.appendChild(counter);

        // --- Режим "Пригласить к обсуждению" (чата нет) ---
        // Идентично нативному renderInvitation() из entitychat.js:
        // кнопка-приглашение внутри блока аватаров + текст приглашения
        if (!chatData.hasChat)
        {
            // Кнопка-приглашение (плюсик) — внутри блока аватаров, после всех аватаров
            var inviteBtn = document.createElement('span');
            inviteBtn.className = 'crm-entity-stream-live-im-user-invite-btn';
            avatarsWrapper.appendChild(inviteBtn);

            // Текст "Пригласить к обсуждению" — после counter
            var inviteText = document.createElement('div');
            inviteText.className = 'crm-entity-stream-live-im-user-invite-text';
            inviteText.textContent = inviteLabel;
            detail.appendChild(inviteText);
        }

        // --- Последнее сообщение (если чат есть) ---
        if (chatData.hasChat && chatData.message)
        {
            // Разделитель между аватарами и сообщением
            var separator = document.createElement('div');
            separator.className = 'crm-entity-stream-live-im-separator';
            detail.appendChild(separator);

            // Блок мессенджера
            var messenger = document.createElement('div');
            messenger.className = 'crm-entity-stream-live-im-messanger';
            detail.appendChild(messenger);

            // Время последнего сообщения
            var time = document.createElement('div');
            time.className = 'crm-entity-stream-live-im-time';
            time.textContent = formatMessageTime(chatData.message.date);
            messenger.appendChild(time);

            // Текст последнего сообщения
            var messageBlock = document.createElement('div');
            messageBlock.className = 'crm-entity-stream-live-im-message';
            messenger.appendChild(messageBlock);

            var messageText = document.createElement('div');
            messageText.className = 'crm-entity-stream-live-im-message-text';
            // Очищаем текст от HTML-тегов (безопасность)
            messageText.textContent = chatData.message.text || '';
            messageBlock.appendChild(messageText);

            // Счётчик непрочитанных
            var messageCounter = document.createElement('div');
            messageCounter.className = 'crm-entity-stream-live-im-message-counter';
            var unreadCount = getUnreadCount(chatData);
            messageCounter.textContent = unreadCount.toString();
            messageCounter.style.display = unreadCount > 0 ? '' : 'none';
            messenger.appendChild(messageCounter);
        }

        // --- Клик-обработчик ---
        section.addEventListener('click', onChatButtonClick);

        return section;
    }

    // ============================================================
    // КЛИК-ОБРАБОТЧИК
    // ============================================================

    /**
     * При клике на кнопку чата:
     * 1. В режиме deal вызывает наш AJAX, в режиме sp — нативный
     *    AJAX-контроллер crm.timeline.chat.get
     * 2. Получает chatId (joinChat находит или создаёт чат)
     * 3. Открывает мессенджер через BX.Messenger.Public.openChat
     */
    function onChatButtonClick(e)
    {
        e.preventDefault();
        e.stopPropagation();

        // Проверяем, что мессенджер доступен
        if (typeof top.BX.Messenger === 'undefined' || !top.BX.Messenger.Public)
        {
            return;
        }

        // Надёжно находим корневой блок кнопки.
        // e.currentTarget может быть ненадёжным при клике по абсолютно
        // позиционированной иконке (z-index:200), поэтому ищем ближайший
        // родительский .ct-chat-button от кликнутого элемента.
        var button = e.target.closest('.ct-chat-button');
        if (!button)
        {
            return;
        }

        var entityTypeId = parseInt(button.getAttribute('data-entity-type-id'), 10);
        var entityId = parseInt(button.getAttribute('data-entity-id'), 10);

        if (entityTypeId <= 0 || entityId <= 0)
        {
            return;
        }

        // Визуальная индикация загрузки
        button.style.opacity = '0.6';
        button.style.pointerEvents = 'none';

        if (config.accessMode === 'deal')
        {
            BX.ajax({
                url: ajaxUrl,
                method: 'POST',
                dataType: 'json',
                data: {
                    action: 'joinChildChat',
                    dealId: dealId,
                    entityTypeId: entityTypeId,
                    entityId: entityId,
                    sessid: BX.message('bitrix_sessid')
                },
                onsuccess: function(response)
                {
                    resetButtonLoading(button);

                    if (response && response.chatId > 0)
                    {
                        top.BX.Messenger.Public.openChat('chat' + response.chatId);
                        return;
                    }

                    showChatError(response && response.error ? response.error : 'chat');
                },
                onfailure: function()
                {
                    resetButtonLoading(button);
                    showChatError('request');
                }
            });
            return;
        }

        // Вызываем нативный контроллер Bitrix24 для открытия чата сущности.
        // crm.timeline.chat.get вызывает Im\Chat::joinChat(), который:
        //   - находит существующий чат по ENTITY_TYPE='CRM', ENTITY_ID='DYNAMIC_1042|{id}'
        //   - если чата нет — создаёт его
        //   - присоединяет текущего пользователя к чату
        //   - возвращает chatId
        BX.ajax.runAction('crm.timeline.chat.get', {
            data: {
                entityId: entityId,
                entityTypeId: entityTypeId
            }
        }).then(function(response)
        {
            // Снимаем индикацию загрузки
            button.style.opacity = '';
            button.style.pointerEvents = '';

            var chatId = response.data.chatId;
            if (chatId > 0)
            {
                // Открываем чат в мессенджере
                top.BX.Messenger.Public.openChat('chat' + chatId);
            }
        }).catch(function(error)
        {
            // Снимаем индикацию загрузки
            button.style.opacity = '';
            button.style.pointerEvents = '';

            // Показываем уведомление об ошибке
            var errorMessage = (error && error.errors && error.errors[0])
                ? error.errors[0].message
                : 'Ошибка открытия чата';

            BX.UI.Notification.Center.notify({
                content: errorMessage,
                autoHideDelay: 5000
            });
        });
    }

    // ============================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================================

    /**
     * Снимает с кнопки индикацию загрузки.
     */
    function resetButtonLoading(button)
    {
        button.style.opacity = '';
        button.style.pointerEvents = '';
    }

    /**
     * Показывает понятную ошибку нашего AJAX-обработчика.
     */
    function showChatError(errorCode)
    {
        var messages = {
            session: 'Сессия истекла. Обновите страницу.',
            access_mode: 'Режим входа по правам сделки отключён.',
            invalid: 'Переданы неверные данные чата.',
            user: 'Не удалось определить текущего пользователя.',
            access_deal: 'Нет права чтения сделки.',
            not_related: 'Смарт-процесс не привязан к этой сделке.',
            chat: 'Не удалось открыть чат.',
            request: 'Ошибка запроса при открытии чата.'
        };

        BX.UI.Notification.Center.notify({
            content: messages[errorCode] || 'Ошибка открытия чата',
            autoHideDelay: 5000
        });
    }

    /**
     * Форматирует ISO-дату последнего сообщения в формат "ЧЧ:ММ".
     * Берёт только время (как в нативном виджете).
     */
    function formatMessageTime(isoDate)
    {
        if (!isoDate)
        {
            return '';
        }

        try
        {
            var date = new Date(isoDate);
            var hours = date.getHours().toString().padStart(2, '0');
            var minutes = date.getMinutes().toString().padStart(2, '0');
            return hours + ':' + minutes;
        }
        catch (e)
        {
            return '';
        }
    }

    /**
     * Получает счётчик непрочитанных сообщений для текущего пользователя.
     * Берётся из userInfos[currentUser].counter.
     */
    function getUnreadCount(chatData)
    {
        var currentUserId = parseInt(BX.message('USER_ID'), 10) || 0;
        if (currentUserId <= 0)
        {
            return 0;
        }

        var userInfos = chatData.userInfos || {};
        var userInfo = userInfos[currentUserId];
        if (userInfo && typeof userInfo.counter !== 'undefined')
        {
            return parseInt(userInfo.counter, 10) || 0;
        }

        return 0;
    }

})();
