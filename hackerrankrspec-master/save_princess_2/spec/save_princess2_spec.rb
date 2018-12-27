require 'spec_helper'
require_relative '../lib/saverbot_2.rb'

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

describe '#next_move' do
  it 'test can output next move for peach above saver' do
    out = capture_stdout do
      saverbot = Saverbot2.new('3',
                               '1 1',
                               ['-p-',
                                '-m-',
                                '---'])
      saverbot.next_move
    end
    expect(out.string).to eq "UP\n"
  end
end

describe '#next_move' do
  it 'test can output next move for peach below saver' do
    out = capture_stdout do
      saverbot = Saverbot2.new('5',
                               '2 1',
                               ['-----',
                                '-----',
                                '-m---',
                                '-----',
                                'p----'])
      saverbot.next_move
    end
    expect(out.string).to eq "DOWN\n"
  end
end

describe '#next_move' do
  it 'test can output next move for peach left of saver' do
    out = capture_stdout do
      saverbot = Saverbot2.new('5',
                               '2 3',
                               ['-----',
                                '-----',
                                'p--m-',
                                '-----',
                                '-----'])
      saverbot.next_move
    end
    expect(out.string).to eq "LEFT\n"
  end
end

describe '#next_move' do
  it 'test can output next move for peach right of saver' do
    out = capture_stdout do
      saverbot = Saverbot2.new('5',
                               '2 1',
                               ['-----',
                                '-----',
                                '-m--p',
                                '-----',
                                '-----'])
      saverbot.next_move
    end
    expect(out.string).to eq "RIGHT\n"
  end
end
