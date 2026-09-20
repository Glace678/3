package net.munique.openmu.game;

import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.RelativeLayout;
import android.util.DisplayMetrics;

import org.libsdl.app.SDLActivity;

public final class GameActivity extends SDLActivity {
    @Override
    protected String[] getLibraries() {
        return new String[] { "SDL3", "main" };
    }

    @Override
    protected String[] getArguments() {
        return MobilePreferences.nativeArguments(this);
    }

    @Override
    protected void onCreate(Bundle state) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyPreferredFrameRate();
        super.onCreate(state);
        if (SDLActivity.mBrokenLibraries) {
            return;
        }
        configureMobileIdentity();
        configureMobileViewport();
        addUtilityButtons();
    }

    private void configureMobileIdentity() {
        MobileIdentity.Credentials credentials = MobileIdentity.derive(BuildConfig.MOBILE_PACKAGE_KEY);
        SDLActivity.nativeSetenv("MU_LOCAL_AUTO_LOGIN", "1");
        SDLActivity.nativeSetenv("MU_MOBILE_LOCAL_AUTO_LOGIN", "1");
        SDLActivity.nativeSetenv("MU_LOCAL_GAME_USERNAME", credentials.username());
        SDLActivity.nativeSetenv("MU_LOCAL_GAME_PASSWORD", credentials.password());
    }

    private void configureMobileViewport() {
        if (mSurface == null) {
            return;
        }
        android.content.SharedPreferences preferences = MobilePreferences.get(this);
        int safePercent = preferences.getInt(MobilePreferences.KEY_SAFE_MARGIN,
            MobilePreferences.DEFAULT_SAFE_MARGIN);
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        int horizontalMargin = Math.round(metrics.widthPixels * safePercent / 100.0f);
        int verticalMargin = Math.round(metrics.heightPixels * safePercent / 100.0f);
        RelativeLayout.LayoutParams surfaceParams = new RelativeLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        surfaceParams.setMargins(horizontalMargin, verticalMargin, horizontalMargin, verticalMargin);
        mSurface.setLayoutParams(surfaceParams);

        int renderPercent = preferences.getInt(MobilePreferences.KEY_RENDER_SCALE,
            MobilePreferences.DEFAULT_RENDER_SCALE);
        mSurface.post(() -> {
            if (renderPercent >= 100) {
                mSurface.getHolder().setSizeFromLayout();
                return;
            }
            int renderWidth = Math.max(320, Math.round(mSurface.getWidth() * renderPercent / 100.0f));
            int renderHeight = Math.max(180, Math.round(mSurface.getHeight() * renderPercent / 100.0f));
            mSurface.getHolder().setFixedSize(renderWidth, renderHeight);
        });
    }

    private void applyPreferredFrameRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }
        int target = MobilePreferences.targetFrameRate(this);
        int maximum = MobilePreferences.maximumRefreshRate(this);
        boolean wantMaximum = target >= maximum;

        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = null;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() != current.getPhysicalWidth()
                || mode.getPhysicalHeight() != current.getPhysicalHeight()) {
                continue;
            }
            if (best == null) {
                best = mode;
                continue;
            }
            // At the slider's maximum, switch the panel to its highest refresh rate;
            // otherwise pick the mode whose refresh is closest to the chosen target.
            boolean better = wantMaximum
                ? mode.getRefreshRate() > best.getRefreshRate()
                : Math.abs(mode.getRefreshRate() - target) < Math.abs(best.getRefreshRate() - target);
            if (better) {
                best = mode;
            }
        }
        if (best != null && best.getModeId() != current.getModeId()) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(attributes);
        }
    }

    private void addUtilityButtons() {
        if (mLayout == null) {
            return;
        }
        LinearLayout utilities = new LinearLayout(this);
        utilities.setOrientation(LinearLayout.HORIZONTAL);
        boolean leftHanded = "left".equals(MobilePreferences.get(this).getString(
            MobilePreferences.KEY_HANDEDNESS, "right"));
        utilities.setGravity(leftHanded ? Gravity.START : Gravity.END);
        utilities.addView(iconButton(android.R.drawable.ic_menu_help,
            getString(R.string.gesture_help), v -> GestureTutorial.show(this, false, null)));
        utilities.addView(iconButton(android.R.drawable.ic_menu_preferences,
            getString(R.string.open_settings), v -> startActivity(new Intent(this, SettingsActivity.class))));

        RelativeLayout.LayoutParams params = new RelativeLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.addRule(RelativeLayout.ALIGN_PARENT_TOP);
        params.addRule(leftHanded ? RelativeLayout.ALIGN_PARENT_START : RelativeLayout.ALIGN_PARENT_END);
        int safePercent = MobilePreferences.get(this).getInt(MobilePreferences.KEY_SAFE_MARGIN,
            MobilePreferences.DEFAULT_SAFE_MARGIN);
        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        int horizontalMargin = Math.round(metrics.widthPixels * safePercent / 100.0f);
        int verticalMargin = Math.round(metrics.heightPixels * safePercent / 100.0f);
        params.topMargin = Math.max(dp(6), verticalMargin);
        if (leftHanded) {
            params.leftMargin = Math.max(dp(8), horizontalMargin);
        } else {
            params.rightMargin = Math.max(dp(8), horizontalMargin);
        }
        mLayout.addView(utilities, params);
    }

    private ImageButton iconButton(int icon, String description, View.OnClickListener listener) {
        android.content.SharedPreferences preferences = MobilePreferences.get(this);
        int uiPercent = preferences.getInt(MobilePreferences.KEY_UI_SCALE,
            MobilePreferences.DEFAULT_UI_SCALE);
        int opacityPercent = preferences.getInt(MobilePreferences.KEY_TOUCH_OPACITY,
            MobilePreferences.DEFAULT_TOUCH_OPACITY);
        int size = Math.max(dp(44), Math.round(dp(52) * uiPercent / 100.0f));
        int inset = Math.max(dp(8), (size - dp(26)) / 2);
        ImageButton button = new ImageButton(this);
        button.setImageResource(icon);
        button.setColorFilter(Color.WHITE);
        button.setBackgroundColor(Color.argb(Math.round(255 * opacityPercent / 100.0f), 16, 20, 24));
        button.setContentDescription(description);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            button.setTooltipText(description);
        }
        button.setPadding(inset, inset, inset, inset);
        button.setOnClickListener(listener);
        button.setMinimumWidth(size);
        button.setMinimumHeight(size);
        button.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
