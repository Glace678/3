# Local Automatic Login

The OpenMU local launcher can skip server selection and the account/password
form when this client already remembers both the game account and its password.
Successful authentication opens the usual character selection screen. Character
creation, selection, saves, and server-side account checks are unchanged.

The launcher enables this using the process-local `MU_LOCAL_AUTO_LOGIN=1` flag.
It is off for a normally launched client. Only a connection to literal
`127.0.0.1`, followed by a game-server address of `127.0.0.1`, can use the saved
credentials automatically. Passwords are neither placed on the command line nor
re-saved by this automatic path.

There is one automatic attempt per client launch. If credentials are missing,
the server is full, the version is incompatible, or authentication fails, the
existing selection, error, and manual login interfaces remain available.
This option does not create an account, bypass authentication, or make an
unavailable server playable offline.

To restore manual login in the local package, set `AutomaticGameLogin` to `false`
in its `Data/Keys/local-settings.json` and restart the launcher.
