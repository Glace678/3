# Local Automatic Login

The OpenMU local launcher skips server selection and the account/password
form, including on first launch. If the client already remembers a game account
and password, it continues using that account and its existing characters.
Otherwise, the local server provisions an installation-specific ordinary game
account and the launcher supplies its credentials only to the game process.
Successful authentication opens the usual character selection screen. Character
creation, selection, saves, and server-side account checks are unchanged.

The launcher enables this using the process-local `MU_LOCAL_AUTO_LOGIN=1` flag.
It is off for a normally launched client. Only a connection to literal
`127.0.0.1`, followed by a game-server address of `127.0.0.1`, can use the saved
or launcher-supplied credentials automatically. Passwords are neither placed on
the command line nor re-saved by this automatic path. The generated game login
is separate from the administrator login and survives restarts and restores
that retain the package's original private keys.

There is one automatic attempt per client launch. If a saved account is missing
its saved password, its credentials cannot be decrypted,
the server is full, the version is incompatible, or authentication fails, the
existing selection, error, and manual login interfaces remain available.
An existing saved account is never silently replaced with an empty account.
This option does not bypass authentication or make an unavailable server playable.

To restore manual login in the local package, set `AutomaticGameLogin` to `false`
in its `Data/Keys/local-settings.json` and restart the launcher.
After upgrading an older package, restart its local service once so the new
first-run account is provisioned. The game account is not a GM account.
