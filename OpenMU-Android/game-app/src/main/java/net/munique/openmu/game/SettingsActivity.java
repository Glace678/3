package net.munique.openmu.game;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;

public final class SettingsActivity extends Activity {
    private static final String[] EFFECT_VALUES = { "low", "balanced", "high" };
    private static final String[] HANDEDNESS_VALUES = { "right", "left" };

    private SeekBar fps;
    private int maxRefreshRate = DisplayRefresh.FALLBACK_REFRESH_RATE;
    private Spinner effects;
    private Spinner handedness;
    private SeekBar renderScale;
    private SeekBar uiScale;
    private SeekBar safeMargin;
    private SeekBar touchOpacity;
    private CheckBox vibration;
    private EditText server;
    private EditText port;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16, 20, 24));
        getWindow().setNavigationBarColor(Color.rgb(16, 20, 24));
        setContentView(createContent());
        loadValues();
    }

    private View createContent() {
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(Color.rgb(242, 244, 246));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(12), 0, dp(12), 0);
        toolbar.setBackgroundColor(Color.rgb(16, 20, 24));
        Button back = toolbarButton(R.string.back, v -> finish());
        toolbar.addView(back);
        TextView title = new TextView(this);
        title.setText(R.string.game_settings);
        title.setTextColor(Color.WHITE);
        title.setTextSize(19);
        title.setGravity(Gravity.CENTER_VERTICAL);
        title.setPadding(dp(12), 0, 0, 0);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(56), 1));
        toolbar.addView(toolbarButton(R.string.gesture_help,
            v -> GestureTutorial.show(this, false, null)));
        toolbar.addView(toolbarButton(R.string.save, v -> saveValues()));
        screen.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(12), dp(24), dp(28));
        scroll.addView(content, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView displayInfo = bodyText();
        int width = Math.max(getResources().getDisplayMetrics().widthPixels, getResources().getDisplayMetrics().heightPixels);
        int height = Math.min(getResources().getDisplayMetrics().widthPixels, getResources().getDisplayMetrics().heightPixels);
        displayInfo.setText(getString(R.string.current_display, width, height));
        content.addView(displayInfo);

        maxRefreshRate = MobilePreferences.maximumRefreshRate(this);
        TextView refreshInfo = bodyText();
        refreshInfo.setText(getString(R.string.max_refresh, maxRefreshRate));
        content.addView(refreshInfo);

        content.addView(sectionTitle(R.string.display));
        fps = slider(maxRefreshRate, DisplayRefresh.MIN_FRAME_RATE, maxRefreshRate, 1);
        content.addView(field(R.string.fps, fpsControl(fps)));
        renderScale = slider(MobilePreferences.DEFAULT_RENDER_SCALE, 50, 100, 5);
        content.addView(field(R.string.render_scale, sliderWithValue(renderScale, 50, 5, "%")));
        effects = spinner(R.array.effect_labels);
        content.addView(field(R.string.effects, effects));
        uiScale = slider(MobilePreferences.DEFAULT_UI_SCALE, 80, 140, 5);
        content.addView(field(R.string.ui_scale, sliderWithValue(uiScale, 80, 5, "%")));
        safeMargin = slider(MobilePreferences.DEFAULT_SAFE_MARGIN, 0, 8, 1);
        content.addView(field(R.string.safe_margin, sliderWithValue(safeMargin, 0, 1, "%")));

        content.addView(sectionTitle(R.string.controls));
        handedness = spinner(R.array.handedness_labels);
        content.addView(field(R.string.handedness, handedness));
        touchOpacity = slider(MobilePreferences.DEFAULT_TOUCH_OPACITY, 35, 100, 5);
        content.addView(field(R.string.touch_opacity, sliderWithValue(touchOpacity, 35, 5, "%")));
        vibration = new CheckBox(this);
        vibration.setText(R.string.vibration);
        vibration.setTextSize(16);
        vibration.setMinHeight(dp(48));
        content.addView(vibration);

        content.addView(sectionTitle(R.string.network));
        server = textField(false);
        content.addView(field(R.string.server_address, server));
        port = textField(true);
        content.addView(field(R.string.server_port, port));

        TextView note = bodyText();
        note.setText(R.string.restart_note);
        note.setPadding(0, dp(18), 0, 0);
        content.addView(note);

        screen.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        SafeArea.apply(screen);
        return screen;
    }

    private void loadValues() {
        SharedPreferences preferences = MobilePreferences.get(this);
        int targetFps = MobilePreferences.targetFrameRate(this);
        fps.setProgress(Math.max(0, targetFps - DisplayRefresh.MIN_FRAME_RATE));
        renderScale.setProgress(toProgress(preferences.getInt(MobilePreferences.KEY_RENDER_SCALE,
            MobilePreferences.DEFAULT_RENDER_SCALE), 50, 5));
        selectValue(effects, EFFECT_VALUES, preferences.getString(MobilePreferences.KEY_EFFECTS, "balanced"));
        uiScale.setProgress(toProgress(preferences.getInt(MobilePreferences.KEY_UI_SCALE,
            MobilePreferences.DEFAULT_UI_SCALE), 80, 5));
        safeMargin.setProgress(toProgress(preferences.getInt(MobilePreferences.KEY_SAFE_MARGIN,
            MobilePreferences.DEFAULT_SAFE_MARGIN), 0, 1));
        selectValue(handedness, HANDEDNESS_VALUES,
            preferences.getString(MobilePreferences.KEY_HANDEDNESS, "right"));
        touchOpacity.setProgress(toProgress(preferences.getInt(MobilePreferences.KEY_TOUCH_OPACITY,
            MobilePreferences.DEFAULT_TOUCH_OPACITY), 35, 5));
        vibration.setChecked(preferences.getBoolean(MobilePreferences.KEY_VIBRATION, true));
        server.setText(preferences.getString(MobilePreferences.KEY_SERVER, MobilePreferences.DEFAULT_SERVER));
        port.setText(Integer.toString(preferences.getInt(MobilePreferences.KEY_PORT, MobilePreferences.DEFAULT_PORT)));
    }

    private void saveValues() {
        String serverValue = server.getText().toString().trim();
        if (!MobilePreferences.isValidServer(serverValue)) {
            server.setError(getString(R.string.invalid_server));
            server.requestFocus();
            return;
        }

        int portValue;
        try {
            portValue = Integer.parseInt(port.getText().toString());
        } catch (NumberFormatException ignored) {
            portValue = 0;
        }
        if (portValue < 1 || portValue > 65535) {
            port.setError(getString(R.string.invalid_port));
            port.requestFocus();
            return;
        }

        int fpsValue = DisplayRefresh.MIN_FRAME_RATE + fps.getProgress();
        MobilePreferences.get(this).edit()
            .putString(MobilePreferences.KEY_FPS, Integer.toString(fpsValue))
            .putInt(MobilePreferences.KEY_RENDER_SCALE, fromProgress(renderScale, 50, 5))
            .putString(MobilePreferences.KEY_EFFECTS, EFFECT_VALUES[effects.getSelectedItemPosition()])
            .putInt(MobilePreferences.KEY_UI_SCALE, fromProgress(uiScale, 80, 5))
            .putInt(MobilePreferences.KEY_SAFE_MARGIN, fromProgress(safeMargin, 0, 1))
            .putString(MobilePreferences.KEY_HANDEDNESS, HANDEDNESS_VALUES[handedness.getSelectedItemPosition()])
            .putInt(MobilePreferences.KEY_TOUCH_OPACITY, fromProgress(touchOpacity, 35, 5))
            .putBoolean(MobilePreferences.KEY_VIBRATION, vibration.isChecked())
            .putString(MobilePreferences.KEY_SERVER, serverValue)
            .putInt(MobilePreferences.KEY_PORT, portValue)
            .apply();
        try {
            MobilePreferences.writeConfig(this);
        } catch (IOException error) {
            Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
    }

    private LinearLayout field(int labelId, View control) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(58));
        TextView label = new TextView(this);
        label.setText(labelId);
        label.setTextColor(Color.rgb(37, 43, 49));
        label.setTextSize(16);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2));
        LinearLayout.LayoutParams controlParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 3);
        controlParams.leftMargin = dp(14);
        row.addView(control, controlParams);
        return row;
    }

    private TextView sectionTitle(int labelId) {
        TextView title = new TextView(this);
        title.setText(labelId);
        title.setTextColor(Color.rgb(190, 48, 40));
        title.setTextSize(15);
        title.setAllCaps(false);
        title.setPadding(0, dp(18), 0, dp(5));
        return title;
    }

    private Spinner spinner(int arrayId) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<CharSequence> adapter = ArrayAdapter.createFromResource(this, arrayId,
            android.R.layout.simple_spinner_item);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setMinimumHeight(dp(48));
        return spinner;
    }

    private SeekBar slider(int initial, int minimum, int maximum, int step) {
        SeekBar slider = new SeekBar(this);
        slider.setMax((maximum - minimum) / step);
        slider.setProgress(toProgress(initial, minimum, step));
        slider.setMinimumHeight(dp(48));
        return slider;
    }

    private LinearLayout sliderWithValue(SeekBar slider, int minimum, int step, String suffix) {
        LinearLayout holder = new LinearLayout(this);
        holder.setOrientation(LinearLayout.HORIZONTAL);
        holder.setGravity(Gravity.CENTER_VERTICAL);
        TextView value = new TextView(this);
        value.setTextColor(Color.rgb(37, 43, 49));
        value.setTextSize(15);
        value.setGravity(Gravity.END);
        value.setMinWidth(dp(58));
        Runnable update = () -> value.setText((minimum + slider.getProgress() * step) + suffix);
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) { update.run(); }
            @Override public void onStartTrackingTouch(SeekBar seekBar) { }
            @Override public void onStopTrackingTouch(SeekBar seekBar) { }
        });
        update.run();
        holder.addView(slider, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        holder.addView(value);
        return holder;
    }

    private LinearLayout fpsControl(SeekBar fpsSlider) {
        LinearLayout holder = new LinearLayout(this);
        holder.setOrientation(LinearLayout.HORIZONTAL);
        holder.setGravity(Gravity.CENTER_VERTICAL);
        TextView value = new TextView(this);
        value.setTextColor(Color.rgb(37, 43, 49));
        value.setTextSize(15);
        value.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        value.setMinWidth(dp(110));
        Runnable update = () -> {
            int hertz = DisplayRefresh.MIN_FRAME_RATE + fpsSlider.getProgress();
            if (hertz >= maxRefreshRate) {
                value.setText(getString(R.string.fps_max, maxRefreshRate));
            } else {
                value.setText(getString(R.string.fps_value, hertz));
            }
        };
        fpsSlider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) { update.run(); }
            @Override public void onStartTrackingTouch(SeekBar seekBar) { }
            @Override public void onStopTrackingTouch(SeekBar seekBar) { }
        });
        update.run();
        holder.addView(fpsSlider, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        holder.addView(value);
        return holder;
    }

    private EditText textField(boolean numeric) {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setTextSize(16);
        field.setInputType(numeric ? InputType.TYPE_CLASS_NUMBER
            : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setMinHeight(dp(48));
        return field;
    }

    private TextView bodyText() {
        TextView view = new TextView(this);
        view.setTextColor(Color.rgb(91, 99, 108));
        view.setTextSize(14);
        return view;
    }

    private Button toolbarButton(int labelId, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(labelId);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setOnClickListener(listener);
        return button;
    }

    private static int toProgress(int value, int minimum, int step) {
        return Math.max(0, (value - minimum) / step);
    }

    private static int fromProgress(SeekBar slider, int minimum, int step) {
        return minimum + slider.getProgress() * step;
    }

    private static void selectValue(Spinner spinner, String[] values, String value) {
        for (int i = 0; i < values.length; i++) {
            if (values[i].equals(value)) {
                spinner.setSelection(i);
                return;
            }
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
