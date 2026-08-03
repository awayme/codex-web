#!/usr/bin/env bash
set -euo pipefail
umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

ssh_key=""
paste_key=0
key_save_path=""
ssh_user=""
ssh_host=""
ssh_port="22"
host_alias="codex-vm"
listen_address="127.0.0.1"
web_port="8080"
callback_ports=("1455" "1457")
container_name="codex-web"
data_volume="codex-web-data"
ssh_volume="codex-web-ssh"
image="codex-web:local"
domain=""
public_ip=""
web_username="codex"
web_password="${CODEX_WEB_INSTALL_PASSWORD:-}"
generated_web_password=0
http_port="80"
https_port="443"
proxy_container_name="codex-web-proxy"
proxy_network="codex-web-network"
caddyfile_volume="codex-web-caddyfile"
caddy_data_volume="codex-web-caddy-data"
caddy_config_volume="codex-web-caddy-config"
caddy_image="caddy:2-alpine"
internal_tls=0
skip_build=0
assume_yes=0
temporary_dir=""
terminal_echo_disabled=0

usage() {
  cat <<'EOF'
Install Codex Web and connect it to an existing Codex CLI VM over SSH.

Usage:
  ./scripts/install-vm.sh [options]

With no connection options, the installer asks for the SSH private key,
username, and IP address or hostname.

Options:
  --ssh-key PATH          Unencrypted SSH private key
  --paste-key             Read an unencrypted private key from standard input
  --key-save-path PATH    Where to save a pasted key
                          (default: ~/.config/codex-web/keys/codex-vm)
  --ssh-user USER         User that owns the existing Codex CLI configuration
  --ssh-host HOST         VM IP address or hostname
  --ssh-port PORT         SSH port (default: 22)
  --host-alias ALIAS      Name shown by Codex Web (default: codex-vm)
  --listen-address ADDR   Web bind address: 127.0.0.1 or 0.0.0.0
                          (default: 127.0.0.1)
  --web-port PORT         Host web port (default: 8080)
  --domain DOMAIN         Existing domain that resolves to this VM
  --public-ip IPV4        Public IPv4 used to create IPV4.sslip.io
  --web-username USER     HTTPS username (default: codex)
                          Set CODEX_WEB_INSTALL_PASSWORD for unattended use
  --http-port PORT        Public HTTP port (default: 80)
  --https-port PORT       Public HTTPS port (default: 443)
  --container-name NAME   Docker container name (default: codex-web)
  --proxy-container NAME  Caddy container name (default: codex-web-proxy)
  --proxy-network NAME    Private Docker network (default: codex-web-network)
  --data-volume NAME      Persistent application volume
                          (default: codex-web-data)
  --ssh-volume NAME       Private SSH configuration volume
                          (default: codex-web-ssh)
  --caddyfile-volume NAME Caddyfile volume (default: codex-web-caddyfile)
  --caddy-data-volume NAME
                          Caddy certificate volume (default: codex-web-caddy-data)
  --caddy-config-volume NAME
                          Caddy runtime config volume
                          (default: codex-web-caddy-config)
  --caddy-image IMAGE     Caddy image (default: caddy:2-alpine)
  --image IMAGE           Docker image tag (default: codex-web:local)
  --internal-tls          Use Caddy's private CA instead of a public certificate;
                          permits nonstandard HTTP and HTTPS host ports
  --skip-build            Use the existing image without rebuilding it
  --yes                   Accept host keys and all replacement prompts
  -h, --help              Show this help

The installer keeps the private key in a dedicated Docker volume. It serves
Codex Web through an authenticated Caddy HTTPS proxy on ports 80 and 443.
OpenAI callback ports 1455 and 1457 remain bound to VM loopback only.
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if ((terminal_echo_disabled)) && [[ -t 0 ]]; then
    stty echo
    terminal_echo_disabled=0
    printf '\n'
  fi
  if [[ -n "$temporary_dir" && -d "$temporary_dir" ]]; then
    rm -rf -- "$temporary_dir"
  fi
}
trap cleanup EXIT

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "$option requires a value"
}

while (($#)); do
  case "$1" in
    --ssh-key)
      require_value "$1" "${2:-}"
      ssh_key="$2"
      shift 2
      ;;
    --paste-key)
      paste_key=1
      shift
      ;;
    --key-save-path)
      require_value "$1" "${2:-}"
      key_save_path="$2"
      shift 2
      ;;
    --ssh-user)
      require_value "$1" "${2:-}"
      ssh_user="$2"
      shift 2
      ;;
    --ssh-host)
      require_value "$1" "${2:-}"
      ssh_host="$2"
      shift 2
      ;;
    --ssh-port)
      require_value "$1" "${2:-}"
      ssh_port="$2"
      shift 2
      ;;
    --host-alias)
      require_value "$1" "${2:-}"
      host_alias="$2"
      shift 2
      ;;
    --listen-address)
      require_value "$1" "${2:-}"
      listen_address="$2"
      shift 2
      ;;
    --web-port)
      require_value "$1" "${2:-}"
      web_port="$2"
      shift 2
      ;;
    --domain)
      require_value "$1" "${2:-}"
      domain="$2"
      shift 2
      ;;
    --public-ip)
      require_value "$1" "${2:-}"
      public_ip="$2"
      shift 2
      ;;
    --web-username)
      require_value "$1" "${2:-}"
      web_username="$2"
      shift 2
      ;;
    --http-port)
      require_value "$1" "${2:-}"
      http_port="$2"
      shift 2
      ;;
    --https-port)
      require_value "$1" "${2:-}"
      https_port="$2"
      shift 2
      ;;
    --container-name)
      require_value "$1" "${2:-}"
      container_name="$2"
      shift 2
      ;;
    --proxy-container)
      require_value "$1" "${2:-}"
      proxy_container_name="$2"
      shift 2
      ;;
    --proxy-network)
      require_value "$1" "${2:-}"
      proxy_network="$2"
      shift 2
      ;;
    --data-volume)
      require_value "$1" "${2:-}"
      data_volume="$2"
      shift 2
      ;;
    --ssh-volume)
      require_value "$1" "${2:-}"
      ssh_volume="$2"
      shift 2
      ;;
    --caddyfile-volume)
      require_value "$1" "${2:-}"
      caddyfile_volume="$2"
      shift 2
      ;;
    --caddy-data-volume)
      require_value "$1" "${2:-}"
      caddy_data_volume="$2"
      shift 2
      ;;
    --caddy-config-volume)
      require_value "$1" "${2:-}"
      caddy_config_volume="$2"
      shift 2
      ;;
    --image)
      require_value "$1" "${2:-}"
      image="$2"
      shift 2
      ;;
    --caddy-image)
      require_value "$1" "${2:-}"
      caddy_image="$2"
      shift 2
      ;;
    --internal-tls)
      internal_tls=1
      shift
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --yes)
      assume_yes=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

prompt_required() {
  local variable_name="$1"
  local prompt="$2"
  local current_value="${!variable_name}"
  if [[ -z "$current_value" ]]; then
    read -r -p "$prompt" current_value
    [[ -n "$current_value" ]] || die "$prompt cannot be empty"
    printf -v "$variable_name" '%s' "$current_value"
  fi
}

confirm() {
  local prompt="$1"
  local answer
  if ((assume_yes)); then
    return 0
  fi
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

is_ipv4() {
  local candidate="$1"
  local octet
  local octets
  [[ "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS="." read -r -a octets <<<"$candidate"
  for octet in "${octets[@]}"; do
    ((10#$octet >= 0 && 10#$octet <= 255)) || return 1
  done
}

discover_public_ipv4() {
  local detected
  detected="$(curl --fail --silent --show-error --max-time 10 \
    --ipv4 https://api.ipify.org 2>/dev/null || true)"
  is_ipv4 "$detected" || return 1
  printf '%s\n' "$detected"
}

generate_password() {
  od -An -N18 -tx1 /dev/urandom | tr -d ' \n'
  printf '\n'
}

generate_session_token() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  printf '\n'
}

save_pasted_private_key() {
  local destination="${1:-}"
  local default_destination="$2"
  local end_marker=""
  local line
  local pasted_key_file="$temporary_dir/pasted_private_key"
  local pasted_line_count=0
  local saw_end=0
  local bracketed_paste_start=$'\e[200~'
  local bracketed_paste_end=$'\e[201~'

  : >"$pasted_key_file"
  chmod 600 "$pasted_key_file"

  printf '%s\n' \
    "Paste the complete unencrypted private key now." \
    "Nothing will be displayed while you paste." \
    "After the END PRIVATE KEY line, press Enter once." \
    "Input stops automatically when that complete line is received."
  if [[ -t 0 ]]; then
    stty -echo
    terminal_echo_disabled=1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"$bracketed_paste_start"}"
    line="${line%"$bracketed_paste_end"}"
    if [[ -z "$end_marker" ]]; then
      [[ -z "$line" ]] && continue
      if [[ "$line" == "-----BEGIN "*"PRIVATE KEY-----" ]]; then
        end_marker="${line/BEGIN/END}"
      else
        if ((terminal_echo_disabled)); then
          stty echo
          terminal_echo_disabled=0
          printf '\n'
        fi
        die "pasted input did not start with a supported BEGIN PRIVATE KEY line"
      fi
    fi

    printf '%s\n' "$line" >>"$pasted_key_file"
    pasted_line_count=$((pasted_line_count + 1))
    if [[ "$line" == "$end_marker" ]]; then
      saw_end=1
      break
    fi
  done

  if ((terminal_echo_disabled)); then
    stty echo
    terminal_echo_disabled=0
    printf '\n'
  fi

  ((saw_end)) || die "pasted private key ended before its END PRIVATE KEY line"
  ((pasted_line_count >= 3)) ||
    die "pasted private key did not contain a key body"
  if ! ssh-keygen -y -P "" -f "$pasted_key_file" >/dev/null 2>&1; then
    die "the pasted key is incomplete, altered by whitespace, passphrase-protected, or not OpenSSH-compatible"
  fi

  if [[ -z "$destination" ]]; then
    read -r -p "Save validated private key to [$default_destination]: " destination
    destination="${destination:-$default_destination}"
  fi
  destination="${destination/#\~/$HOME}"
  [[ -n "$destination" ]] || die "private-key save path cannot be empty"
  if [[ -e "$destination" ]]; then
    confirm "Replace existing private key $destination?" ||
      die "installation cancelled"
  fi

  install -d -m 700 "$(dirname "$destination")"
  install -m 600 "$pasted_key_file" "$destination"
  ssh_key="$destination"
  printf 'Private key saved securely to %s\n' "$ssh_key"
}

run_privileged() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_missing_packages() {
  local packages=("$@")
  command -v apt-get >/dev/null 2>&1 ||
    die "missing required commands and automatic installation is only supported on Debian/Ubuntu"
  confirm "Install required packages (${packages[*]})?" ||
    die "required packages were not installed"
  run_privileged apt-get update
  run_privileged apt-get install -y "${packages[@]}"
}

if ! command -v docker >/dev/null 2>&1; then
  install_missing_packages docker.io
  if command -v systemctl >/dev/null 2>&1; then
    run_privileged systemctl enable --now docker
  elif command -v service >/dev/null 2>&1; then
    run_privileged service docker start
  else
    die "Docker was installed but no supported service manager could start it"
  fi
fi

missing_ssh_packages=()
command -v ssh >/dev/null 2>&1 || missing_ssh_packages+=(openssh-client)
command -v ssh-keygen >/dev/null 2>&1 || missing_ssh_packages+=(openssh-client)
command -v ssh-keyscan >/dev/null 2>&1 || missing_ssh_packages+=(openssh-client)
command -v curl >/dev/null 2>&1 || missing_ssh_packages+=(curl)
command -v ss >/dev/null 2>&1 || missing_ssh_packages+=(iproute2)
if ((${#missing_ssh_packages[@]})); then
  install_missing_packages "${missing_ssh_packages[@]}"
fi

docker_command=(docker)
if ! docker info >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 ||
    die "Docker is not accessible by this user and sudo is unavailable"
  sudo docker info >/dev/null 2>&1 ||
    die "Docker is installed but the daemon is not accessible"
  docker_command=(sudo docker)
fi

docker_run() {
  "${docker_command[@]}" "$@"
}

container_owns_host_binding() {
  local container="$1"
  local container_port="$2"
  local protocol="$3"
  local host_port="$4"

  docker_run container inspect "$container" >/dev/null 2>&1 || return 1
  [[ "$(docker_run inspect "$container" --format '{{.State.Status}}')" == "running" ]] ||
    return 1
  docker_run port "$container" "$container_port/$protocol" 2>/dev/null |
    grep -Eq ":${host_port}$"
}

assert_host_port_available() {
  local protocol="$1"
  local host_port="$2"
  local expected_container="$3"
  local container_port="$4"
  local listeners

  if [[ "$protocol" == "udp" ]]; then
    listeners="$(ss -H -lun "sport = :$host_port" || true)"
  else
    listeners="$(ss -H -ltn "sport = :$host_port" || true)"
  fi
  [[ -n "$listeners" ]] || return 0

  if container_owns_host_binding \
    "$expected_container" "$container_port" "$protocol" "$host_port"; then
    return 0
  fi

  printf 'Host %s port %s is already in use:\n%s\n' \
    "${protocol^^}" "$host_port" "$listeners" >&2
  die "the existing listener was not changed; use a separate ingress such as a Cloudflare Tunnel, or free the port intentionally before rerunning"
}

temporary_dir="$(mktemp -d)"

if [[ -n "$ssh_key" && "$paste_key" == "1" ]]; then
  die "--ssh-key and --paste-key cannot be used together"
fi

if [[ -z "$ssh_key" && "$paste_key" == "0" ]]; then
  printf '%s\n' \
    "How would you like to provide the SSH private key?" \
    "  1) Paste the private key now" \
    "  2) Use an existing private-key file"
  read -r -p "Choose 1 or 2 [1]: " key_source_choice
  key_source_choice="${key_source_choice:-1}"
  case "$key_source_choice" in
    1)
      paste_key=1
      ;;
    2)
      prompt_required ssh_key "SSH private key path: "
      ;;
    *)
      die "choose either 1 to paste or 2 to use an existing path"
      ;;
  esac
fi

if ((paste_key)); then
  default_key_save_path="${XDG_CONFIG_HOME:-$HOME/.config}/codex-web/keys/$host_alias"
  if [[ -z "$key_save_path" ]] && ((assume_yes)); then
    key_save_path="$default_key_save_path"
  fi
  save_pasted_private_key "$key_save_path" "$default_key_save_path"
fi

prompt_required ssh_user "SSH username that owns the Codex CLI configuration: "
prompt_required ssh_host "Codex CLI VM IP address or hostname: "

if [[ -z "$domain" && -z "$public_ip" ]]; then
  if ((assume_yes)); then
    public_ip="$(discover_public_ipv4)" ||
      die "could not detect a public IPv4 address; use --domain or --public-ip"
  else
    read -r -p "Do you already have a domain pointing to this VM? [y/N] " has_domain
    if [[ "$has_domain" == "y" || "$has_domain" == "Y" ]]; then
      prompt_required domain "Domain name: "
    else
      detected_ip="$(discover_public_ipv4 || true)"
      if [[ -n "$detected_ip" ]]; then
        read -r -p "Public IPv4 address [$detected_ip]: " public_ip
        public_ip="${public_ip:-$detected_ip}"
      else
        prompt_required public_ip "Public IPv4 address: "
      fi
    fi
  fi
fi

if [[ -z "$domain" ]]; then
  is_ipv4 "$public_ip" || die "invalid public IPv4 address: $public_ip"
  domain="${public_ip//./-}.sslip.io"
  printf 'Using automatic DNS name %s\n' "$domain"
else
  domain="${domain#https://}"
  domain="${domain#http://}"
  domain="${domain%.}"
fi

if [[ -z "$web_password" ]]; then
  if [[ -t 0 && "$assume_yes" == "0" ]]; then
    read -r -s -p "HTTPS password for $web_username (leave blank to generate): " web_password
    printf '\n'
    if [[ -n "$web_password" ]]; then
      read -r -s -p "Confirm HTTPS password: " web_password_confirmation
      printf '\n'
      [[ "$web_password" == "$web_password_confirmation" ]] ||
        die "HTTPS passwords did not match"
    fi
  fi
  if [[ -z "$web_password" ]]; then
    web_password="$(generate_password)"
    generated_web_password=1
  fi
fi

ssh_key="${ssh_key/#\~/$HOME}"
[[ -f "$ssh_key" ]] || die "SSH key does not exist: $ssh_key"
[[ -r "$ssh_key" ]] || die "SSH key is not readable: $ssh_key"

[[ "$ssh_user" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]] ||
  die "invalid SSH username: $ssh_user"
[[ "$ssh_host" =~ ^[A-Za-z0-9:.%-]+$ ]] ||
  die "invalid SSH hostname or address: $ssh_host"
[[ "$host_alias" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
  die "invalid host alias: $host_alias"
[[ "$container_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid container name: $container_name"
[[ "$proxy_container_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid proxy container name: $proxy_container_name"
[[ "$proxy_network" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid proxy network name: $proxy_network"
[[ "$data_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid data volume name: $data_volume"
[[ "$ssh_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid SSH volume name: $ssh_volume"
[[ "$caddyfile_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid Caddyfile volume name: $caddyfile_volume"
[[ "$caddy_data_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid Caddy data volume name: $caddy_data_volume"
[[ "$caddy_config_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] ||
  die "invalid Caddy config volume name: $caddy_config_volume"
[[ "$web_username" =~ ^[A-Za-z0-9_.@-]+$ ]] ||
  die "invalid HTTPS username: $web_username"
[[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] ||
  die "invalid domain name: $domain"
[[ "$domain" != *..* ]] || die "invalid domain name: $domain"
[[ "$listen_address" == "127.0.0.1" || "$listen_address" == "0.0.0.0" ]] ||
  die "listen address must be 127.0.0.1 or 0.0.0.0"

for port_value in \
  "$ssh_port" \
  "$web_port" \
  "$http_port" \
  "$https_port" \
  "${callback_ports[@]}"; do
  if [[ ! "$port_value" =~ ^[0-9]+$ ]] ||
    ((port_value < 1 || port_value > 65535)); then
    die "invalid port: $port_value"
  fi
done

declare -A planned_tcp_bindings=()
register_tcp_binding() {
  local label="$1"
  local host_port="$2"
  local existing_label="${planned_tcp_bindings[$host_port]:-}"
  if [[ -n "$existing_label" ]]; then
    die "$label and $existing_label both request host TCP port $host_port"
  fi
  planned_tcp_bindings["$host_port"]="$label"
}

register_tcp_binding "the Codex Web application" "$web_port"
for callback_port in "${callback_ports[@]}"; do
  register_tcp_binding "an OpenAI callback bridge" "$callback_port"
done
register_tcp_binding "the Caddy HTTP listener" "$http_port"
register_tcp_binding "the Caddy HTTPS listener" "$https_port"

if ((internal_tls == 0)) &&
  [[ "$http_port" != "80" || "$https_port" != "443" ]]; then
  die "public certificate setup requires host ports 80 and 443"
fi

assert_host_port_available tcp "$web_port" "$container_name" 8080
for callback_port in "${callback_ports[@]}"; do
  assert_host_port_available \
    tcp "$callback_port" "$container_name" "$callback_port"
done
assert_host_port_available tcp "$http_port" "$proxy_container_name" 80
assert_host_port_available tcp "$https_port" "$proxy_container_name" 443
assert_host_port_available udp "$https_port" "$proxy_container_name" 443

if [[ "$listen_address" == "0.0.0.0" ]]; then
  printf '%s\n' \
    "Warning: port $web_port will bypass the authenticated HTTPS proxy." \
    "Keep the Codex Web application port bound to 127.0.0.1."
  confirm "Continue with direct application-port exposure?" ||
    die "installation cancelled"
fi

if ((internal_tls == 0)); then
  resolved_ips="$(
    getent ahostsv4 "$domain" 2>/dev/null |
      awk '{ print $1 }' |
      sort -u
  )"
  [[ -n "$resolved_ips" ]] ||
    die "$domain does not currently resolve to an IPv4 address"
  printf 'Domain %s currently resolves to:\n%s\n' "$domain" "$resolved_ips"
  if [[ -n "$public_ip" ]] &&
    ! grep -Fxq "$public_ip" <<<"$resolved_ips"; then
    die "$domain does not resolve to the expected public IP $public_ip"
  fi
fi

install -m 600 "$ssh_key" "$temporary_dir/remote_key"

if ! ssh-keygen -y -P "" -f "$temporary_dir/remote_key" \
  >"$temporary_dir/remote_key.pub" 2>/dev/null; then
  die "the SSH key must be an unencrypted private key because the container cannot answer a passphrase prompt"
fi

container_ssh_host="$ssh_host"
if [[ "$ssh_host" == "127.0.0.1" || "$ssh_host" == "localhost" || "$ssh_host" == "::1" ]]; then
  container_ssh_host="host.docker.internal"
fi

printf 'Reading the SSH host key from %s:%s...\n' "$ssh_host" "$ssh_port"
if ! ssh-keyscan -T 10 -p "$ssh_port" "$ssh_host" \
  >"$temporary_dir/scanned_hosts" 2>"$temporary_dir/keyscan_errors"; then
  sed -n '1,20p' "$temporary_dir/keyscan_errors" >&2
  die "could not read the SSH host key"
fi
[[ -s "$temporary_dir/scanned_hosts" ]] ||
  die "the SSH server returned no host keys"

known_host_name="$container_ssh_host"
if [[ "$ssh_port" != "22" ]]; then
  known_host_name="[$container_ssh_host]:$ssh_port"
fi
awk -v host="$known_host_name" \
  '!/^#/ && NF >= 3 { print host, $2, $3 }' \
  "$temporary_dir/scanned_hosts" >"$temporary_dir/known_hosts"

printf 'SSH host-key fingerprints:\n'
ssh-keygen -lf "$temporary_dir/known_hosts"
confirm "Trust these host keys for $ssh_host?" ||
  die "installation cancelled because the host keys were not trusted"

printf 'Checking the existing Codex login and managed app-server over SSH...\n'
ssh_options=(
  -F /dev/null
  -i "$temporary_dir/remote_key"
  -o BatchMode=yes
  -o ConnectTimeout=10
  -o IdentitiesOnly=yes
  -o "HostKeyAlias=$known_host_name"
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$temporary_dir/known_hosts"
  -p "$ssh_port"
)
ssh "${ssh_options[@]}" "$ssh_user@$ssh_host" \
  'codex login status >/dev/null && codex app-server daemon version'

if ((skip_build)); then
  docker_run image inspect "$image" >/dev/null 2>&1 ||
    die "Docker image does not exist: $image"
else
  [[ -f "$repo_root/Dockerfile" ]] ||
    die "Dockerfile not found at $repo_root/Dockerfile"
  printf 'Building %s from %s...\n' "$image" "$repo_root"
  docker_run build --tag "$image" "$repo_root"
fi

if ! docker_run image inspect "$caddy_image" >/dev/null 2>&1; then
  printf 'Downloading HTTPS proxy image %s...\n' "$caddy_image"
  docker_run pull "$caddy_image"
fi

web_password_hash="$(
  printf '%s\n' "$web_password" |
    docker_run run --rm --interactive "$caddy_image" caddy hash-password
)"
[[ -n "$web_password_hash" ]] || die "could not hash the HTTPS password"
web_session_token="$(generate_session_token)"

cat >"$temporary_dir/config" <<EOF
Host $host_alias
  HostName $container_ssh_host
  User $ssh_user
  Port $ssh_port
  IdentityFile ~/.ssh/remote_key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts
EOF

{
  printf '%s {\n' "$domain"
  printf '  @public_pwa path /manifest.json /assets/pwa-icon-512.png\n'
  printf '  handle @public_pwa {\n'
  printf '    reverse_proxy %s:8080\n' "$container_name"
  printf '  }\n'
  printf '  handle /__codex_web_logout {\n'
  printf '    header Set-Cookie "codex_web_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict"\n'
  printf '    redir * /__codex_web_login 303\n'
  printf '  }\n'
  printf '  @codex_web_session header_regexp codex_web_session Cookie "(?:^|;[[:space:]]*)codex_web_session=%s(?:;|$)"\n' "$web_session_token"
  printf '  handle @codex_web_session {\n'
  printf '    reverse_proxy %s:8080\n' "$container_name"
  printf '  }\n'
  printf '  handle /__codex_web_login {\n'
  printf '    basic_auth {\n'
  printf '      %s %s\n' "$web_username" "$web_password_hash"
  printf '    }\n'
  printf '    header Set-Cookie "codex_web_session=%s; Path=/; Secure; HttpOnly; SameSite=Strict"\n' "$web_session_token"
  printf '    redir * / 303\n'
  printf '  }\n'
  printf '  handle {\n'
  printf '    redir * /__codex_web_login 303\n'
  printf '  }\n'
  if ((internal_tls)); then
    printf '  tls internal\n'
  fi
  printf '}\n'
} >"$temporary_dir/Caddyfile"

container_exists=0
if docker_run container inspect "$container_name" >/dev/null 2>&1; then
  container_exists=1
  confirm "Replace the existing container $container_name?" ||
    die "installation cancelled"
fi

proxy_container_exists=0
if docker_run container inspect "$proxy_container_name" >/dev/null 2>&1; then
  proxy_container_exists=1
  confirm "Replace the existing HTTPS proxy container $proxy_container_name?" ||
    die "installation cancelled"
fi

ssh_volume_exists=0
if docker_run volume inspect "$ssh_volume" >/dev/null 2>&1; then
  ssh_volume_exists=1
  confirm "Replace the SSH configuration in Docker volume $ssh_volume?" ||
    die "installation cancelled"
fi

caddyfile_volume_exists=0
if docker_run volume inspect "$caddyfile_volume" >/dev/null 2>&1; then
  caddyfile_volume_exists=1
  confirm "Replace the HTTPS configuration in Docker volume $caddyfile_volume?" ||
    die "installation cancelled"
fi

if ((container_exists)); then
  docker_run rm --force "$container_name" >/dev/null
fi
if ((proxy_container_exists)); then
  docker_run rm --force "$proxy_container_name" >/dev/null
fi

docker_run volume create "$data_volume" >/dev/null
if ((ssh_volume_exists == 0)); then
  docker_run volume create "$ssh_volume" >/dev/null
fi
if ((caddyfile_volume_exists == 0)); then
  docker_run volume create "$caddyfile_volume" >/dev/null
fi
docker_run volume create "$caddy_data_volume" >/dev/null
docker_run volume create "$caddy_config_volume" >/dev/null
if ! docker_run network inspect "$proxy_network" >/dev/null 2>&1; then
  docker_run network create "$proxy_network" >/dev/null
fi

printf 'Storing the SSH configuration in Docker volume %s...\n' "$ssh_volume"
docker_run run --rm \
  --user 0 \
  --volume "$ssh_volume:/target" \
  --volume "$temporary_dir:/source:ro" \
  --entrypoint /bin/sh \
  "$image" \
  -c '
    set -eu
    find /target -mindepth 1 -maxdepth 1 -type f -delete
    install -o 10001 -g 10001 -m 600 /source/config /target/config
    install -o 10001 -g 10001 -m 600 /source/known_hosts /target/known_hosts
    install -o 10001 -g 10001 -m 600 /source/remote_key /target/remote_key
  '

printf 'Storing the HTTPS proxy configuration in Docker volume %s...\n' \
  "$caddyfile_volume"
docker_run run --rm \
  --user 0 \
  --volume "$caddyfile_volume:/target" \
  --volume "$temporary_dir:/source:ro" \
  --entrypoint /bin/sh \
  "$caddy_image" \
  -c '
    set -eu
    find /target -mindepth 1 -maxdepth 1 -type f -delete
    install -m 644 /source/Caddyfile /target/Caddyfile
  '

printf 'Starting %s...\n' "$container_name"
docker_run run --detach \
  --name "$container_name" \
  --restart unless-stopped \
  --network "$proxy_network" \
  --add-host host.docker.internal:host-gateway \
  --publish "$listen_address:$web_port:8080" \
  --publish "127.0.0.1:1455:1455" \
  --publish "127.0.0.1:1457:1457" \
  --volume "$data_volume:/data" \
  --volume "$ssh_volume:/run/secrets/codex-ssh:ro" \
  "$image" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent \
    "http://127.0.0.1:$web_port/__backend/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if ((ready == 0)); then
  docker_run logs --tail 100 "$container_name" >&2 || true
  die "Codex Web did not become ready"
fi

for callback_port in "${callback_ports[@]}"; do
  if ! docker_run exec "$container_name" ss -ltn |
    grep -Eq ":${callback_port}[[:space:]]"; then
    docker_run logs --tail 100 "$container_name" >&2 || true
    die "OpenAI callback bridge is not listening on port $callback_port"
  fi
done

printf 'Verifying the container-to-VM Codex connection...\n'
docker_run exec "$container_name" \
  ssh -o BatchMode=yes "$host_alias" codex app-server daemon version

printf 'Starting authenticated HTTPS proxy %s...\n' "$proxy_container_name"
docker_run run --detach \
  --name "$proxy_container_name" \
  --restart unless-stopped \
  --network "$proxy_network" \
  --publish "$http_port:80" \
  --publish "$https_port:443" \
  --publish "$https_port:443/udp" \
  --volume "$caddyfile_volume:/etc/caddy:ro" \
  --volume "$caddy_data_volume:/data" \
  --volume "$caddy_config_volume:/config" \
  "$caddy_image" >/dev/null

https_url="https://$domain"
if [[ "$https_port" != "443" ]]; then
  https_url="$https_url:$https_port"
fi
proxy_curl_options=(
  --fail
  --location
  --silent
  --show-error
  --user "$web_username:$web_password"
  --cookie-jar "$temporary_dir/proxy-cookies"
  --cookie "$temporary_dir/proxy-cookies"
  --resolve "$domain:$https_port:127.0.0.1"
)
if ((internal_tls)); then
  proxy_curl_options+=(--insecure)
fi

proxy_ready=0
for _ in $(seq 1 90); do
  if curl "${proxy_curl_options[@]}" \
    "$https_url/__backend/readyz" >/dev/null 2>&1; then
    proxy_ready=1
    break
  fi
  sleep 2
done
if ((proxy_ready == 0)); then
  docker_run logs --tail 100 "$proxy_container_name" >&2 || true
  die "the authenticated HTTPS endpoint did not become ready"
fi

unauthenticated_status="$(
  curl --insecure --silent --output /dev/null --write-out '%{http_code}' \
    --resolve "$domain:$https_port:127.0.0.1" \
    "$https_url/__backend/readyz"
)"
[[ "$unauthenticated_status" == "303" ]] ||
  die "the HTTPS endpoint is not enforcing authentication"

printf '\nCodex Web is installed and the SSH connection "%s" is ready.\n' "$host_alias"
printf 'Open %s\n' "$https_url"
printf 'HTTPS username: %s\n' "$web_username"
if ((generated_web_password)); then
  printf 'Generated HTTPS password: %s\n' "$web_password"
  printf 'Save this password now; only its hash is stored after installation.\n'
fi
printf '\nThe remote VM login was verified, but the web container keeps a separate\n'
printf 'Codex login in /data. If the web app requests login, run:\n'
printf '  docker exec -it %s codex login --device-auth\n' "$container_name"
printf '\nOpenAI callbacks stay private. If authorization requests localhost,\n'
printf 'use the in-app manual callback dialog, or run this optional tunnel on\n'
printf 'the computer with your browser for automatic delivery:\n'
printf '  ssh -p %s -L 1455:127.0.0.1:1455 -L 1457:127.0.0.1:1457 %s@%s\n' \
  "$ssh_port" "$ssh_user" "$ssh_host"
printf 'In Codex Web, select Settings > Connections > Add > %s.\n' "$host_alias"
