# Self-hosted раннеры: шпаргалка владельца

Краткая русская версия [self-hosted-runner.md](self-hosted-runner.md): как добавить,
переустановить или удалить раннер. Подробности и причины решений описаны в английском
документе.

## Как устроено

| Переменная репозитория | При `true` | Раннеры (метка) |
| --- | --- | --- |
| `CI_SELF_HOSTED` | все задачи CI идут на свои раннеры | `ghrunner-1`, `ghrunner-2` (метка `ci`) |
| `DEPLOY_SELF_HOSTED` | деплой (Deploy Manual MVP) идёт на отдельный раннер | `ghrunner-deploy` (метка `deploy`) |

Если значение не `true`, задачи идут на машины GitHub. Если раннеры выключены, поставь
`false`, иначе задачи будут ждать раннеры в очереди.

Каждый раннер работает в своём LXD-контейнере на Ubuntu 24.04. Двум раннерам CI нельзя
делить один Docker, потому что e2e-стенд занимает фиксированный порт 8443, имя проекта
Compose и подсети. Деплой выполняется на отдельном раннере: только туда GitHub передаёт
SSH-ключ от прода. Задачи CI никогда не попадают на раннер деплоя, потому что у них
разные метки.

Ресурсы, оценка, а не замер:

| Раннер | CPU | RAM | Диск |
| --- | --- | --- | --- |
| CI | 2–4 | 8 ГБ | 10–20 ГБ |
| деплой | 1 | 4 ГБ | пара гигабайт |

## Один раз на хосте (под root)

```sh
snap install lxd
lxd init --auto
lxc storage create raid dir source=/mnt/raid1/lxd
```

Контейнеры раннеров держи только на большом диске (пул `raid`), не на системном SSD. Их
образы Docker, кэш сборки и браузер занимают десятки гигабайт. Прод работает на этом же
сервере, и переполненный системный диск остановит его. Контейнер, который уже стоит на
SSD, переносится так: `lxc stop <имя>`, `lxc move <имя> --storage raid`, `lxc start <имя>`.

Если на хосте включён ufw, он режет DHCP на мосту LXD, и контейнеры остаются без адреса.
Следующие правила разрешают контейнерам только DHCP, DNS к хосту и выход в интернет. К
остальным портам хоста и его сетям Docker доступа нет:

```sh
ufw allow in on lxdbr0 to any port 67 proto udp
ufw allow in on lxdbr0 to any port 53
ufw route allow in on lxdbr0 out on "$(ip route show default | awk '{print $5; exit}')"
```

Скрипт установки лежит в репозитории: `scripts/self-hosted-runner-setup.sh`. Возьми его из
свежего клона, как при обновлении сервера, или скачай на странице файла в GitHub (кнопка
Raw). Положи его в `/root/self-hosted-runner-setup.sh`.

## Общее хранилище образов

Репозиторий приватный, и бесплатной квоты артефактов (около 500 МБ) не хватает на архивы
образов: около 220 МБ на каждый прогон PR и столько же на кандидат релиза. Поэтому на своих
раннерах CI кладёт архив в общую папку `/srv/ci-images/<номер прогона>/`, а в GitHub
загружает только манифест и контрольную сумму. Шарды e2e, сканер и деплой сверяют архив с
этой суммой перед загрузкой, так что подменённый архив не пройдёт. Переключатели
`CI_SELF_HOSTED` и `DEPLOY_SELF_HOSTED` включай и выключай вместе: кандидат, собранный на
своих раннерах, может развернуть только свой раннер деплоя.

Папка лежит на хосте, лучше на большом диске. Раннерам CI она подключена на запись, раннеру
деплоя только на чтение. Каждый день cron удаляет прогоны старше трёх дней. В загруженные
дни это примерно 8–15 ГБ, оценка.

```sh
store=/srv/ci-images   # любая папка на большом диске
install -d -m 1777 "$store"
for name in ghrunner-1 ghrunner-2; do
  lxc config device add "$name" ci-images disk source="$store" path=/srv/ci-images
done
lxc config device add ghrunner-deploy ci-images disk source="$store" path=/srv/ci-images readonly=true
printf '#!/bin/sh\nfind %s -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} +\n' "$store" \
  > /etc/cron.daily/ci-images-prune
chmod 0755 /etc/cron.daily/ci-images-prune
```

Новому раннеру CI подключи папку той же командой `lxc config device add`, новому раннеру
деплоя — с `readonly=true`.

## Добавить раннер

Пример для третьего раннера CI `ghrunner-3`. Для раннера деплоя укажи свои лимиты (1 CPU,
4 GiB) и роль `deploy`.

1. Создай контейнер:

   ```sh
   lxc launch ubuntu:24.04 ghrunner-3 --storage raid \
     -c security.nesting=true \
     -c security.syscalls.intercept.mknod=true \
     -c security.syscalls.intercept.setxattr=true \
     -c limits.cpu=2 -c limits.memory=8GiB
   sleep 10; lxc list -c ns4   # у контейнера должен появиться IPv4-адрес
   ```

2. Возьми токен: **Settings → Actions → Runners → New self-hosted runner → Linux, x64**.
   Из команды `./config.sh ... --token XXXXX` нужен только токен. Он действует час, и им
   можно зарегистрировать несколько раннеров. Никуда его не вставляй, кроме запроса
   скрипта.

3. Установи раннер (имя и роль `ci` или `deploy`):

   ```sh
   lxc file push /root/self-hosted-runner-setup.sh ghrunner-3/root/
   lxc exec ghrunner-3 -- bash /root/self-hosted-runner-setup.sh ghrunner-3 ci
   ```

   Скрипт спросит токен (ввод не отображается) и сам сделает остальное:
   - поставит Docker, git, jq, zstd, python3 и libatomic1;
   - раннеру CI добавит системные библиотеки Chromium и правило sudo ровно на один тест;
   - раннеру деплоя добавит `gh` и SSH-клиент;
   - скачает раннер и сверит его контрольную сумму;
   - зарегистрирует раннер с меткой роли и запустит его как сервис.

   Если скрипт упал, исправь причину и запусти его ещё раз: повторный запуск безопасен.
   Раннер с тем же именем он заменит.

4. В **Settings → Actions → Runners** новый раннер должен стать **Idle** с нужной меткой.

Раннеру деплоя нужен SSH до прода. Проверка из контейнера (подставь значения секретов
`DEPLOY_HOST` и `DEPLOY_SSH_PORT`):

```sh
lxc exec ghrunner-deploy -- bash -c 'timeout 5 bash -c "</dev/tcp/<адрес>/<порт>" && echo ok'
```

## Удалить раннер

1. Внутри контейнера остановить сервис и снять регистрацию. Токен удаления — на странице
   раннера в **Settings → Actions → Runners**.

   ```sh
   lxc exec ghrunner-3 -- bash -c 'cd /home/ci/actions-runner && ./svc.sh stop && ./svc.sh uninstall'
   lxc exec ghrunner-3 -- sudo -u ci bash -c 'cd /home/ci/actions-runner && ./config.sh remove --token <токен удаления>'
   ```

2. Удалить контейнер целиком:

   ```sh
   lxc delete --force ghrunner-3
   ```

   Если контейнер удалён раньше, чем раннер снят с регистрации, раннер останется в списке
   со статусом Offline. Удали его там вручную.

3. Если удалены все раннеры какой-то роли, поставь соответствующую переменную в `false`.

## Обслуживание

- Скрипт ставит еженедельную чистку старых образов Docker и кэша сборки. За свободным
  местом на диске хоста всё равно следи.
- При обновлении `@playwright/test` поправь `playwright_version` в скрипте. Затем в каждом
  контейнере CI выполни `npx -y playwright@<версия> install-deps chromium` под root.
- Пока репозиторий публичный, в **Settings → Actions → General** должно стоять **Require
  approval for all external contributors**. Не одобряй запуск из форка, который меняет
  `.github/`.
