require 'spec_helper'
require_relative '../lib/saverbot.rb'

module Kernel
  def capture_stdout
    out = StringIO.new
    $stdout = out
    yield
    out
  ensure
    $stdout = STDOUT
  end
end

describe '#display_path_to_princess' do
  it 'test display path to princess can output path for 3 x 3 grid' do
    out = capture_stdout do
      saverbot = Saverbot.new(3, ['---',
                                  '-m-',
                                  '--p'])
      saverbot.display_path_to_princess
    end
    expect(out.string).to eq "DOWN\nRIGHT\n"
  end
end

describe '#display_path_to_princess' do
  it 'test display path to princess can output path for 5 x 5 grid' do
    out = capture_stdout do
      saverbot = Saverbot.new(5, ['-----',
                                  '-----',
                                  '--m--',
                                  '-----',
                                  'p----'])
      saverbot.display_path_to_princess
    end
    expect(out.string).to eq "DOWN\nDOWN\nLEFT\nLEFT\n"
  end
end

describe '#display_path_to_princess' do
  it 'test display path to princess can output path for 7 x 7 grid' do
    out = capture_stdout do
      saverbot = Saverbot.new(7, ['------p',
                                  '-------',
                                  '-------',
                                  '---m---',
                                  '-------',
                                  '-------',
                                  '-------'])
      saverbot.display_path_to_princess
    end
    expect(out.string).to eq "UP\nUP\nUP\nRIGHT\nRIGHT\nRIGHT\n"
  end
end
